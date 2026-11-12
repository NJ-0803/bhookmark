import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import express from "express";
import { PGlite } from "@electric-sql/pglite";
import { createWhatsAppExecution, type QueryClient } from "../src/whatsapp/execution.js";
import { createWhatsAppReviewRouter } from "../src/whatsapp/review.js";

// Fixed fictional credentials are only for this disposable loopback process.
process.env.JWT_ACCESS_SECRET = "fictional-local-link-demo-only-access-secret";
process.env.JWT_REFRESH_SECRET = "fictional-local-link-demo-only-refresh-secret";
const { issueAccessToken } = await import("../src/auth.js");
const { createWhatsAppLinkRouter } = await import("../src/whatsapp/linkRoutes.js");
const pg = new PGlite();
for (const path of ["../schema.sql", "../migrations/whatsapp-review.sql", "../migrations/whatsapp-linking.sql"]) await pg.exec(readFileSync(new URL(path, import.meta.url), "utf8"));
await pg.exec("INSERT INTO users(id,created_at) VALUES('fictional-alice',1)");
const engine = createWhatsAppExecution({ transaction: run => pg.transaction(tx => run({ query: async (text: string, params?: any[]) => {
  if (text.includes("pg_advisory_xact_lock")) return { rows: [] }; // Single-connection PGlite serializes transactions.
  return tx.query(text, params);
} } as QueryClient)) }, async () => [{ id: "manual:toit-demo", name: "Toit Indiranagar", address: "Fictional Indiranagar branch" }]);
const secret = "fictional-local-app-secret-no-real-meta-account";
const app = express();
app.use("/whatsapp", createWhatsAppReviewRouter({ enabled: true, appSecret: secret, verifyToken: "fictional-local-verify-token-do-not-reuse", accountId: "111", phoneId: "222", queue: { enqueue: async () => { throw new Error("Execution owns queue"); } }, reviewExecution: engine.process }));
app.use("/link", createWhatsAppLinkRouter(engine, true));
app.use((_err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.sendStatus(503));
const server = app.listen(0, "127.0.0.1");
await new Promise<void>(r => server.once("listening", r));
const base = `http://127.0.0.1:${(server.address() as any).port}`;
const access = issueAccessToken("fictional-alice", "user", Math.floor(Date.now()/1000), "fictional-demo-device");
const headers = { Authorization: `Bearer ${access}`, "Content-Type": "application/json" };
let event = 0;
const chat = async (text: string, id = `fictional-${++event}`) => {
  const body = JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: "111", changes: [{ field: "messages", value: {
    messaging_product: "whatsapp", metadata: { phone_number_id: "222" }, messages: [{ id, from: "15555550101", timestamp: String(Math.floor(Date.now()/1000)), type: "text", text: { body: text } }],
  } }] }] });
  const response = await fetch(base + "/whatsapp/webhook", { method: "POST", headers: { "Content-Type": "application/json", "X-Hub-Signature-256": `sha256=${createHmac("sha256", secret).update(body).digest("hex")}` }, body });
  assert.equal(response.status, 200);
  const result = await pg.query<{ reply: string }>("SELECT reply FROM whatsapp_review_outbox WHERE message_id=$1", [id]);
  return result.rows[0]?.reply;
};
try {
  console.log("BHOOKMARK / LINK + SAVE REVIEW\nDisposable fictional accounts and food. Real SQL in isolated memory, signed loopback HTTP, NO WhatsApp sends or live database.\n");
  assert.match((await chat("Show my saves"))!, /No food has been read/);
  const start = await fetch(base + "/link/start", { method: "POST", headers });
  assert.equal(start.status, 200);
  const { command } = await start.json();
  const proof = await chat(command);
  const confirmation = proof!.match(/code ([a-f0-9]{48})/)![1];
  const status = await fetch(base + "/link/status", { headers });
  assert.equal((await status.json()).pendingSender, "15555550101");
  assert.equal((await fetch(base + "/link/confirm", { method: "POST", headers, body: JSON.stringify({ sender: "15555550101", confirmation }) })).status, 200);
  console.log("1. Signed-in fictional account + sender proof + explicit number confirmation: linked.");
  console.log("2.", await chat("Had pizza at Toit Indiranagar, 0/10", "fictional-save"));
  await chat("Had pizza at Toit Indiranagar, 0/10", "fictional-save");
  const food = (await pg.query<any>("SELECT * FROM food_bookmarks")).rows;
  assert.equal(food.length, 1); assert.equal(Number(food[0].rating), 0);
  console.log("3. Duplicate event: still one dish and one confirmation.");
  const update = await chat("Had pizza at Toit Indiranagar, 8.5/10");
  console.log("4.", update);
  const undo = update!.match(/UNDO [a-f0-9]{48}/)![0];
  console.log("5.", await chat(undo));
  assert.equal(Number((await pg.query<any>("SELECT rating FROM food_bookmarks")).rows[0].rating), 0);
  assert.equal((await fetch(base + "/link/", { method: "DELETE", headers })).status, 200);
  assert.match((await chat("Show my saves"))!, /No food has been read/);
  console.log("6. Unlink: later sender messages no longer read/write food.\n\nPassed. All confirmations stayed in the dry-run outbox. Temporary state removed on exit.");
} finally {
  server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); await pg.close();
}
