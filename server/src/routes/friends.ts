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

// F02 (implementation brief, 2026-09-08): this used to friend two accounts
// instantly on entering a code, no acceptance, and echoed the target's raw
// phone number back. Now it creates a pending request — unless the other
// person already sent *this* user one, in which case entering their code
// is treated as accepting it (so two people who both go to add each other
// still end up friends in one step, just never without either side's
// consent).
friendsRouter.post("/add", requireAuth, async (req, res) => {
  const parsed = addSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: "Enter a friend code." });

  const target = await db.findUserByFriendCode(parsed.data.code);
  if (!target) return res.status(404).json({ ok: false, error: "No one has that code." });
  if (target.id === req.user!.sub) return res.status(400).json({ ok: false, error: "That's your own code." });
  if (await db.areFriends(req.user!.sub, target.id)) {
    return res.status(200).json({ ok: true, status: "already-friends" });
  }

  const existing = await db.getPendingRequestBetween(req.user!.sub, target.id);
  if (existing && existing.senderId === target.id) {
    await db.respondToFriendRequest(existing.id, req.user!.sub, true);
    return res.status(200).json({ ok: true, status: "accepted" });
  }
  if (existing) {
    return res.status(200).json({ ok: true, status: "pending" });
  }

  const result = await db.createFriendRequest(req.user!.sub, target.id);
  if ("alreadyPending" in result) return res.status(200).json({ ok: true, status: "pending" });
  res.status(201).json({ ok: true, status: "pending" });
});

friendsRouter.get("/requests", requireAuth, async (req, res) => {
  const requests = await db.listIncomingFriendRequests(req.user!.sub);
  // Public-shaped sender info only — no phone. (F02)
  const withSender = await Promise.all(
    requests.map(async (r) => ({ id: r.id, sender: { id: r.senderId }, createdAt: r.createdAt }))
  );
  res.json({ ok: true, requests: withSender });
});

const respondSchema = z.object({ accept: z.boolean() });

friendsRouter.post("/requests/:id/respond", requireAuth, async (req, res) => {
  const parsed = respondSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: "Missing decision." });

  const updated = await db.respondToFriendRequest(req.params.id as string, req.user!.sub, parsed.data.accept);
  if (!updated) return res.status(404).json({ ok: false, error: "Request not found or already handled." });
  res.json({ ok: true, status: updated.status });
});

friendsRouter.get("/", requireAuth, async (req, res) => {
  const friends = await db.listFriends(req.user!.sub);
  res.json({ ok: true, friends });
});
