import { createHmac, timingSafeEqual } from "node:crypto";
import express, { Router } from "express";
import { z } from "zod";
import { sql } from "../bookmarks";

/** Review adapter only: no Graph API client, access token or outbound network. */
export interface IncomingText {
  id: string; sender: string; phoneId: string; timestamp: number; text: string;
}
export interface ReviewReply {
  phoneId: string; month: string; messageId: string; recipient: string;
  text: string; expiresAt: number; cap: number;
}
export interface ReviewQueue {
  enqueue(reply: ReviewReply): Promise<"queued" | "duplicate" | "capped">;
}

export function validMetaSignature(raw: Buffer, header: unknown, secret: string): boolean {
  if (!secret || typeof header !== "string" || !/^sha256=[a-f0-9]{64}$/.test(header)) return false;
  const expected = createHmac("sha256", secret).update(raw).digest();
  return timingSafeEqual(expected, Buffer.from(header.slice(7), "hex"));
}
const id = z.string().min(1).max(300);
const envelope = z.object({
  object: z.literal("whatsapp_business_account"),
  entry: z.array(z.object({ id, changes: z.array(z.object({
    field: z.string(), value: z.object({
      messaging_product: z.literal("whatsapp"),
      metadata: z.object({ phone_number_id: z.string().regex(/^\d{1,30}$/) }),
      messages: z.array(z.object({
        id, from: z.string().regex(/^\d{7,15}$/), timestamp: z.string().regex(/^\d{1,12}$/),
        type: z.string(), group_id: z.string().optional(), text: z.object({ body: z.string().trim().min(1).max(2000) }).optional(),
      })).max(100).optional(),
    }),
  })).max(100) })).max(100),
});

export function parseMetaTexts(body: unknown, accountId: string, phoneId: string): IncomingText[] {
  const event = envelope.parse(body);
  const texts: IncomingText[] = [];
  for (const entry of event.entry) {
    if (entry.id !== accountId) throw new Error("Unexpected account");
    for (const change of entry.changes) {
      if (change.field !== "messages") continue;
      if (change.value.metadata.phone_number_id !== phoneId) throw new Error("Unexpected number");
      for (const message of change.value.messages ?? []) {
        if (message.type !== "text" || message.group_id) continue; // No media fetching, transcription or group handling.
        if (!message.text) throw new Error("Missing text");
        texts.push({ id: message.id, sender: message.from, phoneId, timestamp: Number(message.timestamp) * 1000, text: message.text.body });
      }
    }
  }
  return texts;
}

/** The quota lock serializes different webhook deliveries for this number/month.
 * The inbox key makes retries no-ops. Inbox + quota + outbox commit together.
 * Reservations count attempts conservatively, not claimed Meta deliveries.
 */
export function createPostgresReviewQueue(connect: typeof sql = sql): ReviewQueue {
  return { async enqueue(r) {
    const db = connect();
    const result = await db.transaction([
      db`INSERT INTO whatsapp_review_quota (phone_id, month, reserved) VALUES (${r.phoneId}, ${r.month}, 0) ON CONFLICT DO NOTHING`,
      db`SELECT reserved FROM whatsapp_review_quota WHERE phone_id=${r.phoneId} AND month=${r.month} FOR UPDATE`,
      db`WITH accepted AS (
        INSERT INTO whatsapp_review_inbox (phone_id, message_id, received_at)
        VALUES (${r.phoneId}, ${r.messageId}, ${Date.now()})
        ON CONFLICT DO NOTHING RETURNING message_id
      ), allowance AS (
        UPDATE whatsapp_review_quota SET reserved=reserved+1
        WHERE phone_id=${r.phoneId} AND month=${r.month} AND reserved < ${r.cap}
          AND EXISTS (SELECT 1 FROM accepted) RETURNING reserved
      ), queued AS (
        INSERT INTO whatsapp_review_outbox (phone_id, message_id, recipient, reply, expires_at)
        SELECT ${r.phoneId}, ${r.messageId}, ${r.recipient}, ${r.text}, ${r.expiresAt}
        FROM accepted WHERE EXISTS (SELECT 1 FROM allowance) RETURNING message_id
      ) SELECT (SELECT count(*) FROM accepted)::int AS accepted, (SELECT count(*) FROM queued)::int AS queued`,
    ]);
    const row = result[2][0];
    return !Number(row.accepted) ? "duplicate" : Number(row.queued) ? "queued" : "capped";
  } };
}

export interface WhatsAppReviewOptions {
  enabled: boolean; appSecret: string; verifyToken: string; accountId: string; phoneId: string;
  cap?: number; timezone?: string; queue: ReviewQueue; now?: () => number;
  /** Only an isolated fixture simulator should inject account-specific results.
   * Never bind sender to a user by matching an unverified phone/profile/contact.
   */
  fixtureReply?: (message: IncomingText) => Promise<string>;
  /** Isolated interactive-transaction execution; owns dedupe/quota/outbox itself. */
  reviewExecution?: (message: IncomingText) => Promise<unknown>;
}
const UNLINKED = "Bhookmark WhatsApp is in review mode. Account linking is not enabled, so I cannot read or change your saved food. Use the Bhookmark website for now.";
export function createWhatsAppReviewRouter(options?: WhatsAppReviewOptions) {
  const o = options ?? {
    enabled: process.env.BHOOKMARK_WHATSAPP_REVIEW === "1",
    appSecret: process.env.WHATSAPP_APP_SECRET ?? "", verifyToken: process.env.WHATSAPP_VERIFY_TOKEN ?? "",
    accountId: process.env.WHATSAPP_ACCOUNT_ID ?? "", phoneId: process.env.WHATSAPP_PHONE_NUMBER_ID ?? "",
    cap: Number(process.env.WHATSAPP_REVIEW_REPLY_CAP ?? 900),
    timezone: process.env.WHATSAPP_ACCOUNT_TIMEZONE ?? "UTC", queue: createPostgresReviewQueue(),
  };
  const router = Router();
  const cap = o.cap ?? 900, timezone = o.timezone ?? "UTC";
  let validTimezone = true;
  try { new Intl.DateTimeFormat("en-CA", { timeZone: timezone }); } catch { validTimezone = false; }
  const configured = o.appSecret.length >= 32 && o.verifyToken.length >= 32
    && /^\d{1,30}$/.test(o.accountId) && /^\d{1,30}$/.test(o.phoneId)
    && Number.isInteger(cap) && cap >= 1 && cap <= 900 && validTimezone;
  // Hard guard: environment flags or injected dependencies cannot enable production.
  router.use((_req, res, next) => {
    res.set("Cache-Control", "private, no-store");
    if (process.env.NODE_ENV === "production" || !o.enabled || !configured) return res.sendStatus(404);
    next();
  });
  router.get("/webhook", (req, res) => {
    const token = req.query["hub.verify_token"], challenge = req.query["hub.challenge"];
    if (req.query["hub.mode"] !== "subscribe" || typeof token !== "string"
      || typeof challenge !== "string" || !/^\d{1,30}$/.test(challenge)
      || Buffer.byteLength(token) !== Buffer.byteLength(o.verifyToken)
      || !timingSafeEqual(Buffer.from(token), Buffer.from(o.verifyToken))) return res.sendStatus(403);
    return res.type("text/plain").send(challenge);
  });
  // MUST be mounted before express.json. Signature covers the exact raw bytes.
  router.post("/webhook", express.raw({ type: "application/json", limit: "256kb" }), async (req, res) => {
    if (!Buffer.isBuffer(req.body) || !validMetaSignature(req.body, req.headers["x-hub-signature-256"], o.appSecret)) return res.sendStatus(401);
    let messages: IncomingText[];
    try { messages = parseMetaTexts(JSON.parse(req.body.toString("utf8")), o.accountId, o.phoneId); }
    catch { return res.sendStatus(400); }
    const now = (o.now ?? Date.now)();
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit" }).formatToParts(now);
    const month = `${parts.find(p => p.type === "year")!.value}-${parts.find(p => p.type === "month")!.value}`;
    for (const message of messages) {
      // No stale reply, or future timestamp that could extend the service window.
      if (message.timestamp > now + 60_000 || message.timestamp < now - 23 * 3600_000) continue;
      if (o.reviewExecution) { await o.reviewExecution(message); continue; }
      const text = o.fixtureReply ? await o.fixtureReply(message) : UNLINKED;
      if (!text.trim() || text.length > 4000) throw new Error("Invalid review reply");
      await o.queue.enqueue({ phoneId: o.phoneId, month, messageId: message.id, recipient: message.sender,
        text, expiresAt: message.timestamp + 24 * 3600_000, cap });
    }
    // No private data or reply bodies in an externally visible webhook response.
    return res.status(200).json({ ok: true, mode: "review-only", sendsEnabled: false, writesEnabled: false });
  });
  return router;
}
