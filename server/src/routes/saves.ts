import { Router } from "express";
import { z } from "zod";
import * as db from "../db";
import { requireAuth } from "../middleware";

// Saved for later: private per-user bookmarks. Nothing here feeds a public
// surface, a score, or a recommendation signal.
export const savesRouter = Router();

const identitySchema = z.object({
  name: z.string().trim().min(1).max(120),
  venue: z.string().trim().min(1).max(120),
});

const saveSchema = identitySchema.extend({
  area: z.string().trim().max(120).default(""),
  category: z.string().trim().max(60).default(""),
  subtype: z.string().trim().max(60).default(""),
});

savesRouter.get("/", requireAuth, async (req, res) => {
  res.json({ ok: true, saves: await db.listSavedDishes(req.user!.sub) });
});

savesRouter.post("/", requireAuth, async (req, res) => {
  const parsed = saveSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: "A save needs a dish name and a venue." });

  const userId = req.user!.sub;
  const alreadySaved = (await db.listSavedDishes(userId)).some(
    (s) => db.savedDishKey(s.name, s.venue) === db.savedDishKey(parsed.data.name, parsed.data.venue)
  );
  if (!alreadySaved && (await db.countSavedDishes(userId)) >= db.MAX_SAVED_DISHES) {
    return res.status(409).json({ ok: false, error: `You can keep up to ${db.MAX_SAVED_DISHES} saved dishes. Remove a few first.` });
  }

  const { save, created } = await db.saveDish(userId, parsed.data);
  res.status(created ? 201 : 200).json({ ok: true, save, created });
});

savesRouter.delete("/", requireAuth, async (req, res) => {
  const parsed = identitySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: "Say which dish and venue to remove." });
  const removed = await db.unsaveDish(req.user!.sub, parsed.data.name, parsed.data.venue);
  res.json({ ok: true, removed });
});
