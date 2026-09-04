import { Router } from "express";
import webpush from "web-push";
import { z } from "zod";
import * as db from "../db";
import { requireAuth } from "../middleware";
import { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY } from "../vapid";

webpush.setVapidDetails("mailto:dev@bhookmark.local", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

export const notificationsRouter = Router();

notificationsRouter.get("/vapid-public-key", (_req, res) => {
  res.json({ ok: true, key: VAPID_PUBLIC_KEY });
});

const subscribeSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string(), auth: z.string() }),
});

notificationsRouter.post("/subscribe", requireAuth, async (req, res) => {
  const parsed = subscribeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: "Invalid push subscription." });
  const subscribed = await db.addPushSubscription(req.user!.sub, parsed.data);
  res.json({ ok: true, subscribed });
});

notificationsRouter.post("/unsubscribe", requireAuth, async (req, res) => {
  await db.deleteAllPushSubscriptions(req.user!.sub);
  res.json({ ok: true });
});

async function sendToUser(userId: string, payload: { title: string; body: string; tag?: string }) {
  const subs = await db.getPushSubscriptions(userId);
  const results = await Promise.allSettled(
    subs.map((sub) => webpush.sendNotification(sub as webpush.PushSubscription, JSON.stringify(payload)))
  );
  // A 410/404 means the subscription is dead (browser cleared it) — drop it.
  const alive = subs.filter((_, i) => results[i].status === "fulfilled");
  await db.replacePushSubscriptions(userId, alive);
  return { sent: alive.length, failed: results.length - alive.length };
}

// Friend-to-friend engagement (Section 11's real gap): this is the actual
// trigger a "friend logged a dish near you" feature would call in
// production, once real friend graphs + live location exist. Since this
// prototype doesn't have another real user to trigger it, this dev endpoint
// fires the exact same code path against your own subscription so the full
// push pipeline (browser permission -> subscribe -> deliver -> click) is
// genuinely exercised end-to-end, not just described.
const simulateSchema = z.object({
  friendName: z.string().default("Aish"),
  dishName: z.string().default("Benne Masala Dosa"),
  distanceKm: z.number().default(0.4),
});

notificationsRouter.post("/simulate-friend-nearby", requireAuth, async (req, res) => {
  const parsed = simulateSchema.safeParse(req.body);
  const { friendName, dishName, distanceKm } = parsed.success ? parsed.data : simulateSchema.parse({});
  const result = await sendToUser(req.user!.sub, {
    title: `${friendName} just logged nearby`,
    body: `${friendName} rated ${dishName} ${distanceKm}km from you — open Bhookmark to see it.`,
    tag: "friend-nearby",
  });
  if (result.sent === 0) {
    return res.status(400).json({ ok: false, error: "No active push subscription — enable notifications first." });
  }
  res.json({ ok: true, ...result });
});
