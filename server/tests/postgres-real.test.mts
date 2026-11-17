import "./tg-env.mts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseTelegramText } from "../src/telegram/adapter";
import { createWhatsAppExecution, type QueryClient } from "../src/whatsapp/execution";
/** Opt-in. Runs only when BHOOKMARK_TEST_PG_URI points at a LOCAL throwaway Postgres (localhost, 127.0.0.1 or a unix socket)
 * and the `pg` package is installed (it is not a repo dependency: `npm i --no-save pg`).
 * It creates and drops only databases named bhook_test_*, never the database in the URI. */
const uri = process.env.BHOOKMARK_TEST_PG_URI ?? "";
const isLocal = /host=\//.test(uri) || /^postgres(ql)?:\/\/([^@/]*@)?(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(uri);
const skip = !uri ? "set BHOOKMARK_TEST_PG_URI to a local throwaway Postgres to run" : !isLocal ? "refusing: URI is not local" : false;
const here = (f: string) => fileURLToPath(new URL("../" + f, import.meta.url));
const pgModule = "pg";
const pg: any = skip ? null : (await import(pgModule)).default;
const R = [{ id: "manual:toit-ind", name: "Toit", address: "Indiranagar" }];
const search = async (q: string) => R.filter(r => `${r.name} ${r.address}`.toLowerCase().includes(q.toLowerCase()));
async function fresh(short: string, cap: number) {
  const name = "bhook_test_" + short;
  const admin = new pg.Client({ connectionString: uri }); await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${name}`); await admin.query(`CREATE DATABASE ${name}`); await admin.end();
  const url = uri.replace(/\/[^/?]*(\?|$)/, `/${name}$1`);
  const pool = new pg.Pool({ connectionString: url, max: 20 });
  for (const f of ["schema.sql", "migrations/whatsapp-review.sql", "migrations/whatsapp-linking.sql", "migrations/telegram-conversation.sql"]) await pool.query(readFileSync(here(f), "utf8"));
  const db = { async transaction(run: any) { const c = await pool.connect(); try { await c.query("BEGIN"); await c.query("SET LOCAL lock_timeout='2s'"); await c.query("SET LOCAL statement_timeout='5s'");
    const out = await run({ query: async (t: string, p?: any[]) => ({ rows: (await c.query(t, p)).rows }) } as QueryClient); await c.query("COMMIT"); return out; } catch (e) { await c.query("ROLLBACK").catch(() => {}); throw e; } finally { c.release(); } } };
  const engine = createWhatsAppExecution(db as any, search, Date.now, cap, { conversation: true, locking: "fine" });
  let seq = 0;
  const text = (s: string, from: number, id?: number) => parseTelegramText({ update_id: id ?? ++seq, message: { message_id: 1, date: Math.floor(Date.now() / 1000), chat: { id: from, type: "private" }, from: { id: from }, text: s } }, "999")!;
  const press = (data: string, from: number, id?: number) => ({ ...parseTelegramText({ update_id: id ?? ++seq, callback_query: { id: "c" + ++seq, from: { id: from }, data, message: { message_id: 5, chat: { id: from, type: "private" } } } }, "999")!, timestamp: Date.now() });
  const link = async (user: string, from: number) => { const b = await engine.beginLink(user); const r = await engine.process(text(`/start ${b.command.slice(5)}`, from)); const conf = r.reply!.match(/code ([a-f0-9]{48})/)![1]; assert.equal(await engine.confirmLink(user, `tg:${from}`, conf), true); };
  return { pool, engine, text, press, link };
}

test('1 quota exact under parallel load across many real connections', { skip }, async () => {
  const f = await fresh("quota", 10);
  const S = [2000, 2001, 2002, 2003, 2004, 2005];
  for (const s of S) { await f.pool.query("INSERT INTO users(id,created_at) VALUES($1,1)", [`u${s}`]); await f.link(`u${s}`, s); }
  await f.pool.query("UPDATE whatsapp_review_quota SET reserved=0");
  const out = await Promise.all(S.flatMap(s => [1, 2, 3, 4].map(() => f.engine.process(f.text("hi", s)))));
  assert.equal(out.filter((o: any) => o.reply).length, 10);
  assert.equal((await f.pool.query("SELECT reserved FROM whatsapp_review_quota")).rows[0].reserved, 10);
  await f.pool.end();
});
test('2 redelivery of the same update id from many connections writes once; 3 parallel confirm presses save once', { skip }, async () => {
  const f = await fresh("dedupe", 900);
  await f.pool.query("INSERT INTO users(id,created_at) VALUES('alice',1)"); await f.link("alice", 111);
  const nonce = async () => (await f.pool.query("SELECT state FROM tg_conversations WHERE sender='tg:111'")).rows[0]?.state.nonce as string;
  await f.engine.process(f.text("hi", 111));
  await f.engine.process(f.press(`v1:${await nonce()}:ka`, 111));
  await f.engine.process(f.text("Pizza", 111)); await f.engine.process(f.press(`v1:${await nonce()}:cb`, 111)); await f.engine.process(f.text("Toit Indiranagar", 111));
  await f.engine.process(f.press(`v1:${await nonce()}:r8`, 111)); await f.engine.process(f.press(`v1:${await nonce()}:rk`, 111));
  const nn = await nonce();
  const outs = await Promise.all(Array.from({ length: 8 }, () => f.engine.process(f.press(`v1:${nn}:ok`, 111, 900))));
  assert.equal((await f.pool.query("SELECT count(*)::int c FROM food_bookmarks")).rows[0].c, 1);
  assert.equal(outs.filter((o: any) => !o.duplicate).length, 1);
  
  const outs2 = await Promise.all(Array.from({ length: 6 }, (_, i) => f.engine.process(f.press(`v1:${nn}:ok`, 111, 1000 + i))));
  assert.equal((await f.pool.query("SELECT count(*)::int c FROM food_bookmarks")).rows[0].c, 1);
  
  await f.pool.end();
});
test('4 unlink racing messages: no deadlock, no lock timeout', { skip }, async () => {
  const f = await fresh("lock", 900);
  await f.pool.query("INSERT INTO users(id,created_at) VALUES('alice',1)"); await f.link("alice", 111);
  const t0 = Date.now();
  const res = await Promise.allSettled([...Array.from({ length: 10 }, () => f.engine.process(f.text("hi", 111))), f.engine.unlink("alice"), ...Array.from({ length: 10 }, () => f.engine.process(f.text("hi", 111)))]);
  const bad = res.filter(r => r.status === "rejected"); 
  assert.equal(bad.length, 0, JSON.stringify(bad.map((b: any) => String(b.reason))));
  assert.ok(Date.now() - t0 < 4000);
  await f.pool.end();
});
test('5 quota CHECK: constraint now allows the 20000 default cap', { skip }, async () => {
  const f = await fresh("chk", 20000);
  await f.pool.query("INSERT INTO whatsapp_review_quota(phone_id,month,reserved) VALUES($1,$2,20000)",["p","2026-11"]);
  await f.pool.end();
});
test('6 UNDO: parallel UNDO of one save reverses once; another user cannot use the token; reuse is refused', { skip }, async () => {
  const f = await fresh("undo", 900);
  for (const [u, s] of [["alice", 111], ["bob", 222]] as const) { await f.pool.query("INSERT INTO users(id,created_at) VALUES($1,1)", [u]); await f.link(u, s); }
  const nonce = async () => (await f.pool.query("SELECT state FROM tg_conversations WHERE sender='tg:111'")).rows[0]?.state.nonce as string;
  await f.engine.process(f.text("hi", 111));
  await f.engine.process(f.press(`v1:${await nonce()}:ka`, 111));
  await f.engine.process(f.text("Pizza", 111)); await f.engine.process(f.press(`v1:${await nonce()}:cb`, 111)); await f.engine.process(f.text("Toit Indiranagar", 111));
  await f.engine.process(f.press(`v1:${await nonce()}:r8`, 111)); await f.engine.process(f.press(`v1:${await nonce()}:rk`, 111));
  const saved: any = await f.engine.process(f.press(`v1:${await nonce()}:ok`, 111));
  assert.equal((await f.pool.query("SELECT count(*)::int c FROM food_bookmarks")).rows[0].c, 1);
  const tok = /UNDO ([a-f0-9]{48})/.exec(String(saved.reply))?.[1];
  assert.ok(tok, "receipt carries an UNDO token");
  const other: any = await f.engine.process(f.text(`UNDO ${tok}`, 222));
  assert.match(String(other.reply), /Cannot undo/);
  assert.equal((await f.pool.query("SELECT count(*)::int c FROM food_bookmarks")).rows[0].c, 1);
  const outs: any[] = await Promise.all(Array.from({ length: 6 }, () => f.engine.process(f.text(`UNDO ${tok}`, 111))));
  assert.equal((await f.pool.query("SELECT count(*)::int c FROM food_bookmarks")).rows[0].c, 0);
  assert.equal(outs.filter(o => !/Cannot undo/.test(String(o.reply))).length, 1);
  const again: any = await f.engine.process(f.text(`UNDO ${tok}`, 111));
  assert.match(String(again.reply), /Cannot undo/);
  await f.pool.end();
});
