import { Router } from "express";
import { z } from "zod";
import * as db from "../db";
import { requireAuth } from "../middleware";

export const friendsRouter = Router();

// The permanent, personal identity code everything else (Circles) is built
// on top of — lazily created on first request, not at signup, so existing
// users get one the first time they open the feature.
friendsRouter.get("/code", requireAuth, async (req, res) => {
  const code = await db.getOrCreateFriendCode(req.user!.sub);
  res.json({ ok: true, code });
});

const addSchema = z.object({ code: z.string().trim().min(4).max(12) });

// Instant and mutual, like adding a friend in a game — no pending-request
// step. Rejects a self-add and an already-used/unknown code cleanly.
friendsRouter.post("/add", requireAuth, async (req, res) => {
  const parsed = addSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: "Enter a friend code." });

  const target = await db.findUserByFriendCode(parsed.data.code);
  if (!target) return res.status(404).json({ ok: false, error: "No one has that code." });
  if (target.id === req.user!.sub) return res.status(400).json({ ok: false, error: "That's your own code." });

  await db.addFriendship(req.user!.sub, target.id);
  res.status(201).json({ ok: true, friend: { id: target.id, phone: target.phone } });
});

friendsRouter.get("/", requireAuth, async (req, res) => {
  const friends = await db.listFriends(req.user!.sub);
  res.json({ ok: true, friends });
});
