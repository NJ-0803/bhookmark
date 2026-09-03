import { Router } from "express";
import * as db from "../db";
import type { DishLog } from "../db";
import { optionalAuth } from "../middleware";
import { scoreConfidenceBand } from "../evidence";

export const dishesRouter = Router();

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

  res.json({
    ok: true,
    community: { score: avg(matches), count: matches.length },
    verifiedOnly: { score: avg(verified), count: verified.length },
    yours: yours ? { score: yours.score, verdict: yours.verdict } : null,
    confidenceBand: scoreConfidenceBand(matches.length, verified.length),
  });
});
