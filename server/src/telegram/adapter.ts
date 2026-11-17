import { timingSafeEqual } from "node:crypto";
import express, { Router } from "express";
import { z } from "zod";
import type { IncomingText } from "../whatsapp/review";

/** Telegram adapter. Reuses the channel-neutral execution engine; it never
 * discovers secrets, mounts itself in production or sends without an injected sender. */
const update = z.object({
  update_id: z.number().int().nonnegative(),
  message: z.object({
    message_id: z.number().int(),
    date: z.number().int(),
    chat: z.object({ id: z.number().int(), type: z.string() }),
    from: z.object({ id: z.number().int().positive(), is_bot: z.boolean().optional() }).optional(),
    text: z.string().trim().min(1).max(2000).optional(),
  }).optional(),
}).passthrough();

export function validSecretToken(header: unknown, secret: string): boolean {
  if (secret.length < 32 || typeof header !== "string") return false;
  const a = Buffer.from(header), b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Private chats only. "/start CODE" becomes the engine's "LINK CODE" command. */
export function parseTelegramText(body: unknown, botId: string): IncomingText | null {
  const u = update.parse(body), m = u.message;
  if (!m || !m.text || !m.from || m.from.is_bot || m.chat.type !== "private" || m.chat.id !== m.from.id) return null;
  if (!/^\d{3,20}$/.test(botId)) throw new Error("Invalid bot id");
  const start = /^\/start(?:@\w+)?\s+([a-f0-9]{48})$/.exec(m.text);
  return { id: String(u.update_id), sender: `tg:${m.from.id}`, phoneId: `tg:${botId}`, timestamp: m.date * 1000, text: start ? `LINK ${start[1]}` : m.text };
}

export interface TelegramOptions {
  enabled: boolean; secretToken: string; botId: string;
  execute: (message: IncomingText) => Promise<{ reply: string | null }>;
  /** Injected only after the owner approves live sending. Absent = reply is not sent. */
  send?: (chatId: string, text: string) => Promise<void>;
}
export function createTelegramRouter(o: TelegramOptions) {
  const router = Router();
  router.use((_req, res, next) => {
    res.set("Cache-Control", "private, no-store");
    if (!o.enabled || o.secretToken.length < 32 || !/^\d{3,20}$/.test(o.botId)) return res.sendStatus(404);
    next();
  });
  router.post("/webhook", express.json({ limit: "64kb" }), async (req, res) => {
    if (!validSecretToken(req.headers["x-telegram-bot-api-secret-token"], o.secretToken)) return res.sendStatus(401);
    let message: IncomingText | null;
    try { message = parseTelegramText(req.body, o.botId); } catch { return res.sendStatus(400); }
    if (message) {
      const { reply } = await o.execute(message);
      if (reply && o.send) await o.send(message.sender.slice(3), reply);
    }
    return res.sendStatus(200);
  });
  return router;
}
