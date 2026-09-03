import { Router } from "express";
import * as db from "../db";
import { requireAuth } from "../middleware";
import { computeFavorites, computeAvoid, computeNextPicks, computeDigest } from "../recommend";
import { craftRecommendationBlurb, llmConfigured } from "../llm";

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

  const logs = await myLogs(user.id);
  const favorites = computeFavorites(logs, 5);
  const avoid = computeAvoid(logs, 5);
  const picks = computeNextPicks(user, logs, 3);

  const enriched = await Promise.all(
    picks.map(async (pick) => {
      const blurb = await craftRecommendationBlurb(favorites, avoid, pick);
      return { ...pick.dish, reason: blurb.text, reasonSource: blurb.source };
    })
  );

  res.json({ ok: true, picks: enriched, llmConfigured: llmConfigured() });
});

recommendationsRouter.get("/digest", requireAuth, async (req, res) => {
  const user = await db.getUserById(req.user!.sub);
  if (!user) return res.status(404).json({ ok: false, error: "User not found." });
  res.json({ ok: true, digest: computeDigest(user, await myLogs(user.id)) });
});
