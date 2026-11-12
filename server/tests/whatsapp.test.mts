import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import express from "express";
import { PGlite } from "@electric-sql/pglite";
import { createWhatsAppReviewRouter, createPostgresReviewQueue, parseMetaTexts, validMetaSignature, type ReviewReply } from "../src/whatsapp/review";

const secret = "isolated-fixture-app-secret-32-characters";
const token = "isolated-fixture-verify-token-32-characters";
const now = Date.UTC(2026, 10, 12, 12);
const payload = (id = "wamid.fixture", text = "Save pizza at Toit", timestamp = now) => ({ object: "whatsapp_business_account", entry: [{ id: "111", changes: [{ field: "messages", value: {
  messaging_product: "whatsapp", metadata: { phone_number_id: "222" },
  messages: [{ id, from: "15555550101", timestamp: String(Math.floor(timestamp / 1000)), type: "text", text: { body: text } }],
} }] }] });
const signed = (body: string) => `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
async function serve(options: Parameters<typeof createWhatsAppReviewRouter>[0], run: (url: string) => Promise<void>) {
  const app = express(); app.use("/whatsapp", createWhatsAppReviewRouter(options)); app.use(express.json());
  app.use((_err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.sendStatus(503));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  try { await run(`http://127.0.0.1:${(server.address() as any).port}/whatsapp/webhook`); }
  finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
}
const base = { enabled: true, appSecret: secret, verifyToken: token, accountId: "111", phoneId: "222", now: () => now };

test("Meta signature covers exact raw bytes and rejects forged or malformed headers", () => {
  const raw = Buffer.from(JSON.stringify(payload()));
  assert.equal(validMetaSignature(raw, signed(raw.toString()), secret), true);
  assert.equal(validMetaSignature(Buffer.concat([raw, Buffer.from(" ")]), signed(raw.toString()), secret), false);
  for (const bad of [undefined, [], "sha256=abc", "sha256=" + "0".repeat(64)]) assert.equal(validMetaSignature(raw, bad, secret), false);
});

test("Meta parsing binds account and business number, ignores statuses/media and rejects oversized text", () => {
  assert.equal(parseMetaTexts(payload(), "111", "222")[0].sender, "15555550101");
  assert.throws(() => parseMetaTexts(payload(), "333", "222"));
  assert.throws(() => parseMetaTexts(payload(), "111", "333"));
  const p = payload(); delete (p.entry[0].changes[0].value as any).messages;
  assert.deepEqual(parseMetaTexts(p, "111", "222"), []);
  const media = payload(); media.entry[0].changes[0].value.messages[0].type = "image";
  assert.deepEqual(parseMetaTexts(media, "111", "222"), []);
  assert.throws(() => parseMetaTexts(payload("x", "x".repeat(2001)), "111", "222"));
});

test("Review webhook handshake and POST require independent verification, never disclose account data", async () => {
  const queued: ReviewReply[] = [];
  await serve({ ...base, queue: { enqueue: async r => { queued.push(r); return "queued"; } } }, async url => {
    assert.equal((await fetch(url + "?hub.mode=subscribe&hub.challenge=123&hub.verify_token=wrong")).status, 403);
    const verify = await fetch(url + `?hub.mode=subscribe&hub.challenge=123&hub.verify_token=${token}`);
    assert.equal(verify.status, 200); assert.equal(await verify.text(), "123");
    const body = JSON.stringify(payload());
    assert.equal((await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body })).status, 401);
    assert.equal(queued.length, 0);
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "X-Hub-Signature-256": signed(body) }, body });
    assert.equal(response.status, 200); assert.equal((await response.json()).sendsEnabled, false);
    assert.equal(queued.length, 1); assert.match(queued[0].text, /Account linking is not enabled/);
    assert.equal(queued[0].month, "2026-11"); assert.equal(queued[0].cap, 900);
    assert.equal(queued[0].expiresAt, now + 24 * 3600_000);
  });
});

test("Review guard rejects production, incomplete settings, invalid timezone and cap over900", async () => {
  const queue = { enqueue: async () => { throw new Error("Must not access storage"); } };
  for (const patch of [{ enabled: false }, { appSecret: "" }, { cap: 1000 }, { timezone: "not/a-zone" }]) {
    await serve({ ...base, queue, ...patch }, async url => assert.equal((await fetch(url)).status, 404));
  }
  const old = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try { await serve({ ...base, queue }, async url => assert.equal((await fetch(url)).status, 404)); }
  finally { if (old === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = old; }
});

test("Review ignores old/future messages and never sends a follow-up beyond the service window", async () => {
  let queued = 0;
  await serve({ ...base, queue: { enqueue: async () => { queued++; return "queued"; } } }, async url => {
    for (const timestamp of [now - 24 * 3600_000, now + 120_000]) {
      const body = JSON.stringify(payload("old", "Show my saves", timestamp));
      assert.equal((await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "X-Hub-Signature-256": signed(body) }, body })).status, 200);
    }
    assert.equal(queued, 0);
  });
});

test("Durable dry-run inbox/outbox is retry-safe and caps replies across all senders", async () => {
  const pg = new PGlite();
  try {
    const migration = readFileSync(new URL("../migrations/whatsapp-review.sql", import.meta.url), "utf8");
    await pg.exec(migration); await pg.exec(migration);
    const connect = () => {
      const query = (strings: TemplateStringsArray, ...params: unknown[]) => ({ text: strings.reduce((s, part, i) => s + (i ? `$${i}` : "") + part, ""), params });
      (query as any).transaction = (queries: { text: string; params: unknown[] }[]) => pg.transaction(async tx => {
        const results = []; for (const q of queries) results.push((await tx.query(q.text, q.params)).rows); return results;
      });
      return query;
    };
    const queue = createPostgresReviewQueue(connect as any);
    const r: ReviewReply = { phoneId: "222", month: "2026-11", messageId: "one", recipient: "15555550101", text: "Review only", expiresAt: now + 100, cap: 2 };
    const outcomes = await Promise.all([queue.enqueue(r), queue.enqueue(r)]);
    assert.deepEqual(outcomes.sort(), ["duplicate", "queued"]);
    assert.equal(await queue.enqueue({ ...r, messageId: "two", recipient: "15555550102" }), "queued");
    assert.equal(await queue.enqueue({ ...r, messageId: "three" }), "capped");
    assert.equal(await queue.enqueue({ ...r, messageId: "three" }), "duplicate");
    const quota = await pg.query<{ reserved: number }>("SELECT reserved FROM whatsapp_review_quota");
    assert.equal(quota.rows[0].reserved, 2);
    assert.equal((await pg.query("SELECT * FROM whatsapp_review_outbox")).rows.length, 2);
    assert.equal(await queue.enqueue({ ...r, month: "2026-12", messageId: "four" }), "queued");
    assert.equal(await queue.enqueue(r), "duplicate", "old event must not gain a fresh reply after month rollover");
    assert.equal((await pg.query("SELECT * FROM whatsapp_review_outbox WHERE mode <> 'dry-run'")).rows.length, 0);
  } finally { await pg.close(); }
});
