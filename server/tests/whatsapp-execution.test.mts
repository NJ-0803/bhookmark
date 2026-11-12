import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import express from "express";
import { createWhatsAppExecution, type QueryClient } from "../src/whatsapp/execution";
process.env.JWT_ACCESS_SECRET = "execution-isolated-test-access";
process.env.JWT_REFRESH_SECRET = "execution-isolated-test-refresh";
const { createWhatsAppLinkRouter } = await import("../src/whatsapp/linkRoutes");
const { issueAccessToken } = await import("../src/auth");
const restaurant = { id: "manual:toit", name: "Toit Indiranagar", address: "Indiranagar" };
async function fixture(run: (f: Awaited<ReturnType<typeof setup>>) => Promise<void>) {
  const f = await setup(); try { await run(f); } finally { await f.pg.close(); }
}
async function setup() {
  const pg = new PGlite();
  for (const file of ["../schema.sql", "../migrations/whatsapp-review.sql", "../migrations/whatsapp-linking.sql"]) await pg.exec(readFileSync(new URL(file, import.meta.url), "utf8"));
  await pg.exec("INSERT INTO users(id,created_at) VALUES('alice',1),('bob',1)");
  let time = Date.UTC(2026, 10, 12, 10), sequence = 0, failOutbox = false;
  const engine = createWhatsAppExecution({ transaction: run => pg.transaction(tx => run({ query: async (text: string, params?: any[]) => {
    if (text.includes("pg_advisory_xact_lock")) return { rows: [] }; // PGlite has one connection; production PostgreSQL provides this lock.
    if (failOutbox && text.startsWith("INSERT INTO whatsapp_review_outbox")) throw new Error("Injected storage failure");
    return tx.query(text, params);
  } } as QueryClient)) }, async () => [restaurant], () => time);
  const message = (text: string, sender = "15555550101", id = `event-${++sequence}`) => ({ id, sender, phoneId: "222", timestamp: time, text });
  const link = async (userId = "alice", sender = "15555550101") => {
    const start = await engine.beginLink(userId), reply = await engine.process(message(start.command, sender));
    const confirmation = reply.reply!.match(/code ([a-f0-9]{48})/)![1];
    assert.equal(await engine.confirmLink(userId, sender, confirmation), true);
    return confirmation;
  };
  return { pg, engine, message, link, advance: (ms: number) => { time += ms; }, fail: (value: boolean) => { failOutbox = value; } };
}

test("linking requires authenticated intent, actual sender and explicit single-use confirmation", async () => fixture(async f => {
  const start = await f.engine.beginLink("alice");
  assert.equal(await f.engine.confirmLink("alice", "15555550101", "0".repeat(48)), false);
  const pending = await f.engine.process(f.message(start.command));
  const code = pending.reply!.match(/code ([a-f0-9]{48})/)![1];
  assert.deepEqual(await f.engine.linkStatus("alice"), { pendingSender: "15555550101", linkedSender: null });
  assert.equal(await f.engine.confirmLink("bob", "15555550101", code), false);
  assert.equal(await f.engine.confirmLink("alice", "15555550102", code), false);
  assert.equal(await f.engine.confirmLink("alice", "15555550101", code), true);
  assert.equal(await f.engine.confirmLink("alice", "15555550101", code), false);
  assert.match((await f.engine.process(f.message(start.command))).reply!, /invalid, used or expired/);
  const stored = (await f.pg.query<{ token_hash: string }>("SELECT token_hash FROM whatsapp_link_intents")).rows[0];
  assert.notEqual(stored.token_hash, start.command.slice(5));
}));

test("link expiry, conflicts, unlink and unknown sender fail closed without account takeover", async () => fixture(async f => {
  assert.match((await f.engine.process(f.message("Show my saves"))).reply!, /No food has been read/);
  const expired = await f.engine.beginLink("alice"); f.advance(11 * 60_000);
  assert.match((await f.engine.process(f.message(expired.command))).reply!, /expired/);
  await f.link();
  const other = await f.engine.beginLink("bob"), p = await f.engine.process(f.message(other.command));
  const c = p.reply!.match(/code ([a-f0-9]{48})/)![1];
  assert.equal(await f.engine.confirmLink("bob", "15555550101", c), false);
  assert.match((await f.engine.process(f.message("STOP"))).reply!, /link removed/);
  await f.engine.unlink("alice");
  assert.match((await f.engine.process(f.message("Had pizza at Toit Indiranagar, 8/10"))).reply!, /No food has been read/);
  assert.equal((await f.pg.query("SELECT * FROM food_bookmarks")).rows.length, 0);
}));

test("SQL food execution preserves zero, notes and branch identity; event retry is one mutation and reply", async () => fixture(async f => {
  await f.link();
  const event = f.message("Had pizza at Toit Indiranagar, 0/10");
  const replies = await Promise.all([f.engine.process(event), f.engine.process(event)]);
  assert.equal(replies.filter(r => r.duplicate).length, 1);
  let food = (await f.pg.query<any>("SELECT * FROM food_bookmarks")).rows;
  assert.equal(food.length, 1); assert.equal(Number(food[0].rating), 0); assert.equal(food[0].tried, true);
  await f.pg.query("UPDATE food_bookmarks SET note='keep this note',reference_url='https://example.com/' WHERE user_id='alice'");
  await f.engine.process(f.message("Had pizza at Toit Indiranagar, 8.5/10"));
  food = (await f.pg.query<any>("SELECT * FROM food_bookmarks")).rows;
  assert.equal(food.length, 1); assert.equal(food[0].note, "keep this note"); assert.equal(Number(food[0].rating), 8.5);
  assert.equal(food[0].reference_url, "https://example.com/");
  assert.equal((await f.pg.query("SELECT * FROM whatsapp_review_outbox WHERE message_id=$1", [event.id])).rows.length, 1);
  assert.equal((await f.pg.query("SELECT * FROM food_bookmarks WHERE user_id='bob'")).rows.length, 0);
  const invalid = await f.engine.process(f.message("Had pizza at Toit Indiranagar, 7.3/10"));
  assert.match(invalid.reply!, /half-point/);
}));

test("undo restores prior state once, and refuses cross-account or changed-food overwrite", async () => fixture(async f => {
  await f.link();
  const first = await f.engine.process(f.message("Save pizza at Toit Indiranagar"));
  const removeToken = first.reply!.match(/UNDO ([a-f0-9]{48})/)![1];
  const update = await f.engine.process(f.message("Had pizza at Toit Indiranagar, 9/10"));
  const token = update.reply!.match(/UNDO ([a-f0-9]{48})/)![1];
  assert.match((await f.engine.process(f.message(`UNDO ${removeToken}`))).reply!, /dish changed/);
  assert.match((await f.engine.process(f.message(`UNDO ${token}`))).reply!, /Undone/);
  const row = (await f.pg.query<any>("SELECT * FROM food_bookmarks")).rows[0];
  assert.equal(row.rating, null); assert.equal(row.tried, false);
  assert.match((await f.engine.process(f.message(`UNDO ${token}`))).reply!, /already used/);
  await f.link("bob", "15555550102");
  assert.match((await f.engine.process(f.message(`UNDO ${removeToken}`, "15555550102"))).reply!, /Cannot undo/);
  await f.engine.process(f.message(`UNDO ${removeToken}`));
  assert.equal((await f.pg.query("SELECT * FROM food_bookmarks")).rows.length, 0);
}));

test("food, event, quota and dry-run confirmation roll back together on storage failure", async () => fixture(async f => {
  await f.link();
  const event = f.message("Save pizza at Toit Indiranagar"); f.fail(true);
  await assert.rejects(f.engine.process(event), /Injected storage failure/);
  assert.equal((await f.pg.query("SELECT * FROM food_bookmarks")).rows.length, 0);
  assert.equal((await f.pg.query("SELECT * FROM whatsapp_execution_events WHERE message_id=$1", [event.id])).rows.length, 0);
  f.fail(false); assert.match((await f.engine.process(event)).reply!, /Saved/);
  await f.pg.exec("UPDATE whatsapp_review_quota SET reserved=900");
  const capped = await f.engine.process(f.message("Had pizza at Toit Indiranagar, 10/10"));
  assert.equal(capped.reply, null);
  assert.equal((await f.pg.query<any>("SELECT rating FROM food_bookmarks")).rows[0].rating, null);
}));

test("link HTTP endpoints require fresh verified session and cannot run in production", async () => fixture(async f => {
  const app = express(); app.use("/link", createWhatsAppLinkRouter(f.engine, true));
  const server = app.listen(0, "127.0.0.1"); await new Promise<void>(r => server.once("listening", r));
  const url = `http://127.0.0.1:${(server.address() as any).port}/link`;
  try {
    assert.equal((await fetch(url + "/start", { method: "POST" })).status, 401);
    const old = issueAccessToken("alice", "user", 1, "d");
    assert.equal((await fetch(url + "/start", { method: "POST", headers: { Authorization: `Bearer ${old}` } })).status, 401);
    const token = issueAccessToken("alice", "user", Math.floor(Date.now()/1000), "d");
    const response = await fetch(url + "/start", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
    assert.equal(response.status, 200); assert.match((await response.json()).command, /^LINK /);
    const before = process.env.NODE_ENV; process.env.NODE_ENV = "production";
    try { assert.equal((await fetch(url + "/status", { headers: { Authorization: `Bearer ${token}` } })).status, 404); }
    finally { if (before === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = before; }
  } finally { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); }
}));
