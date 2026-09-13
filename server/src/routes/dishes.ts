import { Router } from "express";
import { z } from "zod";
import * as db from "../db";
import type { DishLog } from "../db";
import { optionalAuth } from "../middleware";
import { scoreConfidenceBand } from "../evidence";
import { resolveCategory } from "../aliases";

export const dishesRouter = Router();

const browseSchema = z.object({ category: z.string() });

// Backs Home's Crave-tab category browsing (no location required, unlike
// /venues/nearby) — the real venues/dishes tables instead of the old
// static src/data/dishes.ts array. Category resolved through
// category_aliases first, same structural fix as /venues/nearby.
dishesRouter.get("/browse", async (req, res) => {
  const parsed = browseSchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ ok: false, error: "Provide a category." });

  const aliasMap = await db.getCategoryAliasMap();
  const category = resolveCategory(parsed.data.category, aliasMap);
  if (!category) {
    return res.json({ ok: true, category: parsed.data.category, categoryResolved: false, count: 0, results: [] });
  }

  const rows = await db.listCatalogDishesForBrowse(category, 40);
  res.json({
    ok: true,
    category,
    categoryResolved: true,
    count: rows.length,
    results: rows.map((r) => ({
      id: r.id,
      category: r.category,
      subtype: r.subtype,
      name: r.name,
      venue: r.venue,
      area: r.area,
      photo: r.photoUrl,
      community: { score: r.evidenceScore, count: r.evidenceCount },
    })),
  });
});

// Public read: only published logs are ever visible outside the owner's
// own account — a held or removed log never contributes to a public score.
dishesRouter.get("/:category/:subtype", async (req, res) => {
  const { category, subtype } = req.params as { category: string; subtype: string };
  const matches = await db.listPublishedLogsByCategorySubtype(category, subtype);
  const verifiedCount = matches.filter((l) => l.verified).length;
  res.json({
    ok: true,
    count: matches.length,
    verifiedPct: matches.length ? Math.round((verifiedCount / matches.length) * 100) : 0,
    averageScore: matches.length ? matches.reduce((s, l) => s + l.score, 0) / matches.length : null,
  });
});

const TRENDING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const TRENDING_MIN_COUNT = 5;
const TRENDING_MIN_USERS = 3;

// Real trending signal (brief 1.6): never label something "trending"
// without a defined recent-time-window calculation behind it. Returns null
// — not a fallback guess — when nothing in the last 7 days clears the
// minimum-evidence floor, which is the honest, expected state pre-launch.
dishesRouter.get("/trending", async (_req, res) => {
  const trending = await db.getTrendingDish(TRENDING_WINDOW_MS, TRENDING_MIN_COUNT, TRENDING_MIN_USERS);
  res.json({ ok: true, trending, windowDays: 7 });
});

function avg(logs: DishLog[]): number | null {
  return logs.length ? logs.reduce((s, l) => s + l.score, 0) / logs.length : null;
}

// Score separation (brief section 1.2): a dish page must show Your rating,
// Community rating and Verified-only rating as distinct numbers with real
// sample sizes — never one blended figure with fake precision. This is keyed
// to one exact venue+category+subtype+name, unlike the city-wide endpoint
// above, so it actually matches what a dish profile screen displays.
dishesRouter.get("/score", optionalAuth, async (req, res) => {
  const { venue, category, subtype, name } = req.query as Record<string, string | undefined>;
  if (!venue || !category || !subtype || !name) {
    return res.status(400).json({ ok: false, error: "venue, category, subtype and name are all required." });
  }

  const matches = await db.listPublishedLogsForDish(venue, category, subtype, name);
  const verified = matches.filter((l) => l.verified);
  const yours = req.user
    ? (await db.listLogsForUser(req.user.sub)).find(
        (l) => l.status !== "removed" && l.venue === venue && l.category === category && l.subtype === subtype && l.name === name
      )
    : undefined;

  // Real log notes, not the static "Consensus notes" seed copy the frontend
  // used to render unconditionally (Phase 1, 2026-09-10 fix) — same
  // filter/slice pattern already used for Near Me's `reviews`, so a dish
  // page can show actual user text instead of fabricated taste notes.
  const notes = matches
    .filter((l) => l.note.trim().length > 0)
    .slice(0, 3)
    .map((l) => ({ verdict: l.verdict, note: l.note, score: l.score, createdAt: l.createdAt }));

  res.json({
    ok: true,
    community: { score: avg(matches), count: matches.length },
    verifiedOnly: { score: avg(verified), count: verified.length },
    yours: yours ? { score: yours.score, verdict: yours.verdict } : null,
    confidenceBand: scoreConfidenceBand(matches.length, verified.length),
    notes,
  });
});
