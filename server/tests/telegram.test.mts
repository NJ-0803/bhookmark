import "./tg-env.mts";
import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";
import { createTelegramRouter, parseTelegramText, validSecretToken } from "../src/telegram/adapter";

const secret = "isolated-telegram-secret-token-32chars";
const upd = (text: string, over: any = {}) => ({ update_id: 7, message: { message_id: 1, date: 1_700_000_000, chat: { id: 123456789, type: "private" }, from: { id: 123456789, is_bot: false }, text, ...over } });

test("secret token compared exactly", () => {
  assert.equal(validSecretToken(secret, secret), true);
  for (const bad of [undefined, "", secret + "x", "short"]) assert.equal(validSecretToken(bad, secret), false);
  assert.equal(validSecretToken("short", "short"), false);
});

test("parses private text, maps /start code to LINK, ignores groups and bots", () => {
  const code = "a".repeat(48);
  assert.deepEqual(parseTelegramText(upd("Save pizza at Toit"), "999"), { id: "7", sender: "tg:123456789", phoneId: "tg:999", timestamp: 1_700_000_000_000, text: "Save pizza at Toit" });
  assert.equal(parseTelegramText(upd(`/start ${code}`), "999")!.text, `LINK ${code}`);
  assert.equal(parseTelegramText(upd("hi", { chat: { id: -5, type: "group" } }), "999"), null);
  assert.equal(parseTelegramText(upd("hi", { from: { id: 123456789, is_bot: true } }), "999"), null);
  assert.equal(parseTelegramText({ update_id: 1 }, "999"), null);
});

async function post(opts: any, headers: any, body: unknown) {
  const app = express(); app.use("/telegram", createTelegramRouter(opts));
  const server = app.listen(0, "127.0.0.1"); await new Promise<void>(r => server.once("listening", r));
  try {
    const r = await fetch(`http://127.0.0.1:${(server.address() as any).port}/telegram/webhook`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
    return r.status;
  } finally { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); }
}

test("webhook: 404 disabled, 401 bad secret, executes and only sends when a sender is injected", async () => {
  const seen: string[] = [], sent: string[] = [];
  const base = { enabled: true, secretToken: secret, botId: "999", execute: async (m: any) => { seen.push(m.text); return { reply: "ok" }; } };
  assert.equal(await post({ ...base, enabled: false }, { "x-telegram-bot-api-secret-token": secret }, upd("hi")), 404);
  assert.equal(await post(base, { "x-telegram-bot-api-secret-token": "nope" }, upd("hi")), 401);
  assert.equal(await post(base, { "x-telegram-bot-api-secret-token": secret }, upd("Show my saves")), 200);
  assert.deepEqual([seen.length, sent.length], [1, 0]);
  assert.equal(await post({ ...base, send: async (_c: string, t: string) => { sent.push(t); } }, { "x-telegram-bot-api-secret-token": secret }, upd("Show my saves")), 200);
  assert.deepEqual(sent, ["ok"]);
});

import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { createWhatsAppExecution, senderPattern, type QueryClient } from "../src/whatsapp/execution";

const restaurant = { id: "manual:toit", name: "Toit Indiranagar", address: "Indiranagar" };
async function fixture(run: (f: any) => Promise<void>, cap = 900) {
  const pg = new PGlite();
  for (const file of ["../schema.sql", "../migrations/whatsapp-review.sql", "../migrations/whatsapp-linking.sql"]) await pg.exec(readFileSync(new URL(file, import.meta.url), "utf8"));
  await pg.exec("INSERT INTO users(id,created_at) VALUES('alice',1),('bob',1)");
  let time = Date.UTC(2026, 10, 12, 10), seq = 0;
  const engine = createWhatsAppExecution({ transaction: r => pg.transaction(tx => r({ query: async (t: string, p?: any[]) => t.includes("pg_advisory_xact_lock") ? { rows: [] } : tx.query(t, p) } as QueryClient)) }, async () => [restaurant], () => time, cap);
  const tg = (text: string, id = String(++seq), from = 555111222) => parseTelegramText(upd(text, { chat: { id: from, type: "private" }, from: { id: from, is_bot: false }, date: Math.floor(time / 1000) }) && { update_id: Number(id), message: { message_id: 1, date: Math.floor(time / 1000), chat: { id: from, type: "private" }, from: { id: from }, text } }, "999")!;
  try { await run({ pg, engine, tg, advance: (ms: number) => { time += ms; } }); } finally { await pg.close(); }
}
const codeOf = (r: { reply: string | null }) => r.reply!.match(/code ([a-f0-9]{48})/)![1];

test("sender pattern: WhatsApp digits unchanged, Telegram namespaced, junk rejected", () => {
  for (const ok of ["15555550101", "tg:1", "tg:555111222", "tg:1234567890123456"]) assert.equal(senderPattern.test(ok), true, ok);
  for (const bad of ["tg:0", "tg:", "tg:12345678901234567", "tg:-5", "tg:1a", "123456", "TG:5", " tg:5"]) assert.equal(senderPattern.test(bad), false, bad);
});

test("Telegram link flow with ownership checks, replay dedupe and expiry", async () => fixture(async f => {
  const start = await f.engine.beginLink("alice");
  const pending = await f.engine.process(f.tg(`/start ${start.command.slice(5)}`, "10"));
  assert.match(pending.reply, /Telegram account id/);
  const code = codeOf(pending);
  assert.equal(await f.engine.confirmLink("bob", "tg:555111222", code), false);
  assert.equal(await f.engine.confirmLink("alice", "tg:555111223", code), false);
  assert.equal(await f.engine.confirmLink("alice", "555111222", code), false);
  assert.equal(await f.engine.confirmLink("alice", "tg:555111222", code), true);
  const saved = await f.engine.process(f.tg("Had pizza at Toit Indiranagar, 8/10", "11"));
  assert.match(saved.reply, /Saved pizza/);
  const replay = await f.engine.process(f.tg("Had pizza at Toit Indiranagar, 8/10", "11"));
  assert.deepEqual([replay.duplicate, replay.reply], [true, saved.reply]);
  assert.equal((await f.pg.query("SELECT 1 FROM food_bookmarks")).rows.length, 1);
  const undo = saved.reply.match(/UNDO ([a-f0-9]{48})/)![1];
  assert.match((await f.engine.process(f.tg(`UNDO ${undo}`, "12"))).reply, /Undone/);
  assert.match((await f.engine.process(f.tg(`UNDO ${undo}`, "13"))).reply, /Cannot undo/);
  assert.match((await f.engine.process(f.tg("STOP", "14"))).reply, /Telegram account link removed/);
  assert.match((await f.engine.process(f.tg("Show my saves", "15"))).reply, /No food has been read/);
  const old = await f.engine.beginLink("alice"); f.advance(11 * 60_000);
  assert.match((await f.engine.process(f.tg(`/start ${old.command.slice(5)}`, "16"))).reply, /expired/);
}));

test("Telegram id equal to a real WhatsApp number neither reads nor displaces that link", async () => fixture(async f => {
  const wa = (text: string, id: string) => ({ id, sender: "555111222", phoneId: "999", timestamp: Date.UTC(2026, 10, 12, 10), text });
  const s = await f.engine.beginLink("alice");
  const code = codeOf(await f.engine.process(wa(s.command, "w1")));
  assert.equal(await f.engine.confirmLink("alice", "555111222", code), true);
  assert.match((await f.engine.process(f.tg("Show my saves", "20"))).reply, /No food has been read/);
  const b = await f.engine.beginLink("bob");
  const c = codeOf(await f.engine.process(f.tg(`/start ${b.command.slice(5)}`, "21")));
  assert.equal(await f.engine.confirmLink("bob", "tg:555111222", c), true);
  assert.deepEqual((await f.pg.query("SELECT sender,user_id FROM whatsapp_links ORDER BY sender")).rows, [{ sender: "555111222", user_id: "alice" }, { sender: "tg:555111222", user_id: "bob" }]);
  assert.equal((await f.pg.query("SELECT 1 FROM whatsapp_execution_events WHERE phone_id='tg:999'")).rows.length >= 1, true);
}));

test("untrusted text cannot link, mutate, or escalate; quota cap refuses without mutation", async () => fixture(async f => {
  for (const [i, t] of ["LINK " + "a".repeat(48), "/start nothex", "UNDO " + "b".repeat(48), "'; DROP TABLE users; --", "x".repeat(1990)].entries()) {
    const r = await f.engine.process(f.tg(t, String(30 + i)));
    assert.match(r.reply, /Link your account|invalid, used or expired/);
  }
  assert.equal((await f.pg.query("SELECT count(*)::int n FROM users")).rows[0].n, 2);
}));
test("quota cap is enforced per bot and configurable", async () => fixture(async f => {
  const s = await f.engine.beginLink("alice");
  await f.engine.process(f.tg(`/start ${s.command.slice(5)}`, "40"));
  await f.engine.process(f.tg("Show my saves", "41"));
  const over = await f.engine.process(f.tg("Show my saves", "42"));
  assert.equal(over.reply, null);
}, 2));

test("cross-channel conflicts are refused explicitly and never displace an existing link", async () => fixture(async f => {
  const wa = (text: string, id: string) => ({ id, sender: "15555550101", phoneId: "222", timestamp: Date.UTC(2026, 10, 12, 10), text });
  const s = await f.engine.beginLink("alice");
  assert.equal(await f.engine.confirmLink("alice", "15555550101", codeOf(await f.engine.process(wa(s.command, "w1")))), true);
  // Alice already linked on WhatsApp: a Telegram link attempt for the same account is refused.
  const s2 = await f.engine.beginLink("alice");
  assert.match((await f.engine.process(f.tg(`/start ${s2.command.slice(5)}`, "50"))).reply, /already linked.*Nothing was changed/);
  // Bob's Telegram chat is free, but Alice's existing sender cannot be taken by Bob either.
  const b = await f.engine.beginLink("bob");
  assert.match((await f.engine.process(wa(b.command, "w2"))).reply, /already linked.*Nothing was changed/);
  assert.deepEqual((await f.pg.query("SELECT sender,user_id FROM whatsapp_links")).rows, [{ sender: "15555550101", user_id: "alice" }]);
  // STOP from Telegram for an unlinked chat cannot unlink Alice's WhatsApp.
  assert.match((await f.engine.process(f.tg("STOP", "51"))).reply, /No food has been read/);
  assert.equal((await f.pg.query("SELECT 1 FROM whatsapp_links")).rows.length, 1);
}));

import { createTelegramSender, createTelegramRouterFromEnv } from "../src/telegram/wiring";
test("sender validates token/chat id, posts once, and never leaks the token in errors", async () => {
  const token = "123456789:" + "A".repeat(35);
  assert.throws(() => createTelegramSender("bad"));
  const calls: any[] = [];
  const send = createTelegramSender(token, (async (url: string, init: any) => { calls.push([url, JSON.parse(init.body)]); return { ok: true, status: 200 }; }) as any);
  await send("555111222", "hi");
  assert.deepEqual(calls[0][1], { chat_id: 555111222, text: "hi", parse_mode: "HTML", disable_web_page_preview: true });
  await assert.rejects(() => send("abc", "x"));
  const failing = createTelegramSender(token, (async () => ({ ok: false, status: 500 })) as any);
  await assert.rejects(() => failing("5", "x"), (e: Error) => !e.message.includes(token));
});
test("long hex codes are wrapped as tap-to-copy code and other text is escaped", async () => {
  const { formatTelegramHtml } = await import("../src/telegram/wiring");
  const code = "ab12".repeat(12);
  assert.equal(formatTelegramHtml(`confirm with code ${code}. a<b & c`), `confirm with code <code>${code}</code>. a&lt;b &amp; c`);
  assert.equal(formatTelegramHtml("UNDO " + code), `UNDO <code>${code}</code>`);
  assert.equal(formatTelegramHtml("Saved 4.5/10 <b>x</b>"), "Saved 4.5/10 &lt;b&gt;x&lt;/b&gt;");
});
test("env wiring is a 404 unless explicitly enabled", async () => {
  const app = express(); app.use("/telegram", createTelegramRouterFromEnv({ DATABASE_URL: "postgres://x" } as any));
  const server = app.listen(0, "127.0.0.1"); await new Promise<void>(r => server.once("listening", r));
  try { const r = await fetch(`http://127.0.0.1:${(server.address() as any).port}/telegram/webhook`, { method: "POST" }); assert.equal(r.status, 404); }
  finally { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); }
});
