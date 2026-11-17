import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import express from "express";
import { createWhatsAppExecution, type QueryClient } from "../src/whatsapp/execution";
import { parseTelegramText } from "../src/telegram/adapter";
process.env.JWT_ACCESS_SECRET = "telegram-link-isolated-access";
process.env.JWT_REFRESH_SECRET = "telegram-link-isolated-refresh";
const { createWhatsAppLinkRouter } = await import("../src/whatsapp/linkRoutes");
const { issueAccessToken } = await import("../src/auth");

test("website link flow end to end for Telegram, incl. production allowance and unlink", async () => {
  const pg = new PGlite();
  for (const file of ["../schema.sql", "../migrations/whatsapp-review.sql", "../migrations/whatsapp-linking.sql"]) await pg.exec(readFileSync(new URL(file, import.meta.url), "utf8"));
  await pg.exec("INSERT INTO users(id,created_at) VALUES('alice',1),('bob',1)");
  const engine = createWhatsAppExecution({ transaction: r => pg.transaction(tx => r({ query: async (t: string, p?: any[]) => t.includes("pg_advisory_xact_lock") ? { rows: [] } : tx.query(t, p) } as QueryClient)) },
    async () => [{ id: "manual:toit", name: "Toit Indiranagar", address: "Indiranagar" }]);
  const before = process.env.NODE_ENV; process.env.NODE_ENV = "production";
  const mk = (allow: boolean) => { const app = express(); app.use("/link", createWhatsAppLinkRouter(engine, true, allow)); const s = app.listen(0, "127.0.0.1"); return s; };
  const blocked = mk(false), open = mk(true);
  await Promise.all([blocked, open].map(s => new Promise<void>(r => s.once("listening", r))));
  const url = (s: any) => `http://127.0.0.1:${s.address().port}/link`;
  const auth = (user: string) => ({ Authorization: `Bearer ${issueAccessToken(user, "user", Math.floor(Date.now() / 1000), "d")}`, "Content-Type": "application/json" });
  try {
    assert.equal((await fetch(url(blocked) + "/status", { headers: auth("alice") })).status, 404);
    const start = await (await fetch(url(open) + "/start", { method: "POST", headers: auth("alice") })).json();
    const token = start.command.slice(5);
    // Telegram "Start" press arrives at the bot as "/start <token>"
    const msg = parseTelegramText({ update_id: 1, message: { message_id: 1, date: Math.floor(Date.now() / 1000), chat: { id: 4242, type: "private" }, from: { id: 4242 }, text: `/start ${token}` } }, "999")!;
    const botReply = await engine.process({ ...msg, timestamp: Date.now() });
    const code = botReply.reply!.match(/code ([a-f0-9]{48})/)![1];
    assert.deepEqual(await (await fetch(url(open) + "/status", { headers: auth("alice") })).json(), { pendingSender: "tg:4242", linkedSender: null });
    assert.equal((await fetch(url(open) + "/confirm", { method: "POST", headers: auth("bob"), body: JSON.stringify({ sender: "tg:4242", confirmation: code }) })).status, 409);
    assert.equal((await fetch(url(open) + "/confirm", { method: "POST", headers: auth("alice"), body: JSON.stringify({ sender: "tg:4243", confirmation: code }) })).status, 409);
    assert.equal((await fetch(url(open) + "/confirm", { method: "POST", headers: auth("alice"), body: JSON.stringify({ sender: "tg:4242", confirmation: code }) })).status, 200);
    assert.deepEqual(await (await fetch(url(open) + "/status", { headers: auth("alice") })).json(), { pendingSender: null, linkedSender: "tg:4242" });
    const saved = await engine.process({ ...parseTelegramText({ update_id: 2, message: { message_id: 2, date: Math.floor(Date.now() / 1000), chat: { id: 4242, type: "private" }, from: { id: 4242 }, text: "Had pizza at Toit Indiranagar, 8/10" } }, "999")!, timestamp: Date.now() });
    assert.match(saved.reply!, /Saved pizza/);
    assert.equal((await fetch(url(open), { method: "DELETE", headers: auth("alice") })).status, 200);
    assert.deepEqual(await (await fetch(url(open) + "/status", { headers: auth("alice") })).json(), { pendingSender: null, linkedSender: null });
  } finally {
    if (before === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = before;
    for (const s of [blocked, open]) { s.closeAllConnections(); await new Promise<void>(r => s.close(() => r())); }
    await pg.close();
  }
});
