import { Router } from "express";
import * as db from "../db";
import { requireAuth } from "../middleware";
import { computeFavorites, computeAvoid, computeNextPicks, computeDigest } from "../recommend";

export const recommendationsRouter = Router();

async function myLogs(userId: string) {
  const logs = await db.listLogsForUser(userId);
  return logs.filter((l) => l.status !== "removed");
}

recommendationsRouter.get("/favorites", requireAuth, async (req, res) => {
  res.json({ ok: true, favorites: computeFavorites(await myLogs(req.user!.sub)) });
});

recommendationsRouter.get("/avoid", requireAuth, async (req, res) => {
  res.json({ ok: true, avoid: computeAvoid(await myLogs(req.user!.sub)) });
});

recommendationsRouter.get("/next", requireAuth, async (req, res) => {
  const user = await db.getUserById(req.user!.sub);
  if (!user) return res.status(404).json({ ok: false, error: "User not found." });

  const [logs, catalog] = await Promise.all([myLogs(user.id), db.listCatalogDishesWithScores()]);
  const picks = computeNextPicks(user, logs, catalog, 3);

  // Never a raw `score` field here — a pick with no real evidence yet
  // must not carry a number a client could render as if it were one
  // (Phase 1's honesty fix, applied at the source now instead of only at
  // display time). Home.tsx already fetches the same real evidence
  // separately per pick via GET /dishes/score; `hasEvidence` just lets
  // the reason text and ordering be self-consistent with that.
  const enriched = picks.map((pick) => ({
    id: pick.dish.id,
    category: pick.dish.category,
    subtype: pick.dish.subtype,
    name: pick.dish.name,
    venue: pick.dish.venue,
    area: pick.dish.area,
    reason: pick.reason,
    hasEvidence: pick.hasEvidence,
  }));

  res.json({ ok: true, picks: enriched });
});

recommendationsRouter.get("/digest", requireAuth, async (req, res) => {
  const user = await db.getUserById(req.user!.sub);
  if (!user) return res.status(404).json({ ok: false, error: "User not found." });
  const [logs, catalog] = await Promise.all([myLogs(user.id), db.listCatalogDishesWithScores()]);
  const digest = computeDigest(user, logs, catalog);
  res.json({
    ok: true,
    digest: {
      ...digest,
      nextPicks: digest.nextPicks.map((pick) => ({
        id: pick.dish.id,
        category: pick.dish.category,
        subtype: pick.dish.subtype,
        name: pick.dish.name,
        venue: pick.dish.venue,
        area: pick.dish.area,
        reason: pick.reason,
        hasEvidence: pick.hasEvidence,
      })),
    },
  });
});
