import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import express from "express";
import { PGlite } from "@electric-sql/pglite";
import { createWhatsAppReviewRouter, createPostgresReviewQueue } from "../src/whatsapp/review.js";
import { previewMessage } from "../src/chat/preview.js";

// Entirely fictional. No .env loader, Neon connection, access token or Graph call.
const secret = "fictional-demo-only-app-secret-do-not-use";
const pg = new PGlite();
await pg.exec(readFileSync(new URL("../migrations/whatsapp-review.sql", import.meta.url), "utf8"));
const connect = () => {
  const query = (strings: TemplateStringsArray, ...params: unknown[]) => ({ text: strings.reduce((s, part, i) => s + (i ? `$${i}` : "") + part, ""), params });
  (query as any).transaction = (queries: { text: string; params: unknown[] }[]) => pg.transaction(async tx => {
    const result = []; for (const q of queries) result.push((await tx.query(q.text, q.params)).rows); return result;
  });
  return query;
};
const app = express();
const restaurants = [{ id: "manual:demo-toit", name: "Toit Indiranagar", address: "Indiranagar, Bengaluru" }];
app.use("/whatsapp", createWhatsAppReviewRouter({
  enabled: true, appSecret: secret, verifyToken: "fictional-demo-only-verification-token", accountId: "111", phoneId: "222", cap: 2,
  queue: createPostgresReviewQueue(connect as any),
  fixtureReply: async message => {
    const p = await previewMessage("fictional-demo-user", message.text, { list: async () => [], search: async () => restaurants });
    return p.reply;
  },
}));
app.use((_err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.sendStatus(503));
const server = app.listen(0, "127.0.0.1");
await new Promise<void>(resolve => server.once("listening", resolve));
try {
  const url = `http://127.0.0.1:${(server.address() as any).port}/whatsapp/webhook`;
  const post = async (id: string, text: string, tamper = false) => {
    const body = JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: "111", changes: [{ field: "messages", value: {
      messaging_product: "whatsapp", metadata: { phone_number_id: "222" },
      messages: [{ id, from: "15555550101", timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body: text } }],
    } }] }] });
    return fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "X-Hub-Signature-256": `sha256=${createHmac("sha256", secret).update(tamper ? "different bytes" : body).digest("hex")}` }, body });
  };
  console.log("BHOOKMARK / DIRECT WHATSAPP REVIEW SIMULATOR\nFictional fixtures. Loopback HTTP only. No WhatsApp messages or food writes.\n");
  assert.equal((await post("demo-one", "Had pizza at Toit Indiranagar, 8.5/10")).status, 200);
  assert.equal((await post("demo-one", "Had pizza at Toit Indiranagar, 8.5/10")).status, 200);
  assert.equal((await post("demo-forged", "Show my saves", true)).status, 401);
  assert.equal((await post("demo-two", "Show my saves")).status, 200);
  assert.equal((await post("demo-three", "Show my saves")).status, 200);
  const { rows } = await pg.query<{ reply: string; mode: string }>("SELECT reply, mode FROM whatsapp_review_outbox ORDER BY message_id");
  assert.equal(rows.length, 2);
  for (const [i, r] of rows.entries()) console.log(`Dry-run reply ${i + 1}: ${r.reply} (${r.mode})`);
  console.log("\nVerified: signed webhook accepted; forged signature rejected; duplicate queued once; shared demo cap2 enforced.\nNeither the queued replies nor the sample rating were sent or saved. Temporary database removed on exit.\nTo see the conversation UI separately: npm run demo:chat");
} finally {
  server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await pg.close();
}
