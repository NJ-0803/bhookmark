import "./tg-env.mts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { advance, splitDishes, type ConvResult, type ConvState } from "../src/telegram/conversation";
import { createTelegramRouter, parseTelegramText } from "../src/telegram/adapter";
import { createTelegramSender } from "../src/telegram/wiring";
import { createWhatsAppExecution, type EngineOptions, type QueryClient } from "../src/whatsapp/execution";
import type { Bookmark } from "../src/bookmarks";
import express from "express";

const R = [
  { id: "manual:toit-ind", name: "Toit", address: "Indiranagar" },
  { id: "manual:toit-kor", name: "Toit", address: "Koramangala" },
  { id: "manual:meghana", name: "Meghana Foods", address: "Residency Road" },
];
const plain = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
const search = async (q: string) => R.filter(r => plain(`${r.name} ${r.address}`).includes(plain(q)));
const NOW = Date.UTC(2026, 10, 12, 10);
const mk = (over: Partial<Bookmark> = {}): Bookmark => ({ id: "b1", restaurantId: "manual:toit-ind", restaurantName: "Toit", address: "Indiranagar", name: "Pizza", note: "keep me", referenceUrl: "", tried: false, rating: null, createdAt: 1, ...over } as Bookmark);

// ---------- conversation unit tests (pure, no database) ----------
let t = NOW;
const step = (s: ConvState | null, input: { text: string } | { data: string }, existing: Bookmark[] = []) => advance(s, input, { existing, search, now: t });
const tap = (r: ConvResult, code: string, existing: Bookmark[] = []) => step(r.state, { data: `v1:${r.state!.nonce}:${code}` }, existing);
const say = (r: ConvResult, text: string, existing: Bookmark[] = []) => step(r.state, { text }, existing);
const skipReview = (r: ConvResult, existing: Bookmark[] = []) => { assert.equal(r.state!.step, "review"); return tap(r, "rk", existing); };
const labels = (r: ConvResult) => (r.buttons ?? []).flat().map(b => b.text);

test("unclear text becomes a menu, never a guess or a write", async () => {
  const r = await step(null, { text: "biryani was great" });
  assert.equal(r.save, undefined);
  assert.deepEqual(labels(r), ["Save for later", "Ate it", "Show my saves"]);
  assert.match(r.reply, /won't guess/);
});

test("full choice flow: ate it -> dish -> restaurant -> branch -> rating -> confirm -> save", async () => {
  let r = await step(null, { text: "menu" });
  r = await tap(r, "ka"); assert.match(r.reply, /What's the dish/);
  r = await say(r, "Pizza"); assert.match(r.reply, /Which restaurant/);
  r = await say(r, "Toit"); assert.match(r.reply, /Which one/); assert.equal(r.buttons!.length, 4); // 2 branches + none + nav
  r = await tap(r, "p1"); assert.match(r.reply, /How was Pizza/);
  assert.deepEqual(labels(r).filter(l => /^\d+$/.test(l)), ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]);
  r = await tap(r, "r8"); assert.match(r.reply, /Want to add a review\? It stays private/); assert.deepEqual(labels(r), ["Add review", "Skip", "Back", "Cancel"]);
  r = await tap(r, "rk"); assert.match(r.reply, /Save Pizza at Toit \(Koramangala\) - ate it, 8\/10\?/);
  assert.deepEqual(labels(r), ["Confirm", "Edit", "Cancel"]);
  r = await tap(r, "ok");
  assert.equal(r.state, null);
  assert.deepEqual(r.save, { operation: "save", input: { restaurantId: "manual:toit-kor", restaurantName: "Toit", address: "Koramangala", name: "Pizza", note: "", referenceUrl: "", tried: true, rating: 8 } });
});

test("save for later skips the rating question", async () => {
  let r = await tap(await step(null, { text: "hello" }), "kl");
  r = await say(r, "Dosa"); r = await say(r, "Meghana Foods");
  assert.match(r.reply, /Save Dosa at Meghana Foods .* save for later\?/);
  assert.equal((await tap(r, "ok")).save!.input.tried, false);
});

test("one-line messages ask only for what is missing", async () => {
  let r = await step(null, { text: "Had pizza at Toit Indiranagar, 8.5/10" });
  assert.equal(r.state!.step, "review"); r = await skipReview(r);
  assert.match(r.reply, /ate it, 8.5\/10\?/); assert.equal(r.state!.step, "confirm");
  r = await step(null, { text: "Save pizza at Toit Indiranagar" });
  assert.match(r.reply, /save for later\?/);
  r = await step(null, { text: "Had pizza at Toit Indiranagar" });
  assert.equal(r.state!.step, "rating");
  r = await skipReview(await tap(r, "rs")); assert.match(r.reply, /ate it, no rating\?/);
  assert.equal((await tap(r, "ok")).save!.input.rating, null);
});

test("ratings: new ratings only 1-10 in half steps, by text or button; Skip is explicit", async () => {
  for (const bad of ["Had pizza at Toit Indiranagar, 8.3/10", "Had pizza at Toit Indiranagar, 11/10", "Had pizza at Toit Indiranagar, -1/10"]) {
    const r = await step(null, { text: bad }); assert.match(r.reply, /half-point/); assert.equal(r.state, null);
  }
  let r = await step(null, { text: "Had pizza at Toit Indiranagar" });
  for (const bad of ["8.3", "11", "-1", "great", "7/11"]) { const x = await say(r, bad); assert.equal(x.state!.step, "rating"); assert.equal(x.save, undefined); }
  assert.match((await skipReview(await say(r, "9.5"))).reply, /9\.5\/10/);
  assert.match((await say(r, "0")).reply, /1 to 10/); // a NEW 0 is rejected; an existing legacy 0 is untouched
  assert.match((await skipReview(await say(r, "7 / 10"))).reply, /7\/10/);
});

test("restaurant: none found re-asks, several become choices, text number or name picks", async () => {
  let r = await tap(await step(null, { text: "x" }), "ka"); r = await say(r, "Pizza");
  const none = await say(r, "Nowhere Place"); assert.match(none.reply, /couldn't find/); assert.equal(none.state!.step, "restaurant");
  const many = await say(r, "Toit"); assert.equal(many.state!.step, "pick");
  assert.equal((await say(many, "2")).state!.draft.restaurant!.address, "Koramangala");
  assert.equal((await say(many, "7")).state!.step, "pick");
  const none2 = await tap(many, "pn"); assert.equal(none2.state!.step, "restaurant");
  assert.equal((await say(r, "x".repeat(121))).state!.step, "restaurant");
});

test("several dishes in one message: choose one, or keep the name as written", async () => {
  assert.deepEqual(splitDishes("pizza and pasta"), ["pizza", "pasta"]);
  assert.equal(splitDishes("Butter Chicken"), null);
  let r = await step(null, { text: "Save pizza and pasta at Toit Indiranagar" });
  assert.equal(r.state!.step, "split"); assert.match(r.reply, /one at a time/);
  const first = await tap(r, "sp1"); assert.match(first.reply, /Saving "pasta" first/); assert.match(first.reply, /Save pasta at Toit/);
  const keep = await tap(r, "spa"); assert.match(keep.reply, /Save pizza and pasta at Toit/);
  r = await tap(await step(null, { text: "x" }), "kl"); r = await say(r, "mac & cheese");
  assert.equal(r.state!.step, "split");
  assert.equal((await tap(r, "spa")).state!.step, "restaurant");
});

test("back, cancel, menu and corrections", async () => {
  let r = await tap(await step(null, { text: "x" }), "ka");
  assert.equal((await say(r, "back")).state!.step, "kind");
  r = await say(r, "Pizza"); r = await say(r, "Toit Indiranagar"); assert.equal(r.state!.step, "rating");
  assert.equal((await tap(r, "bk")).state!.step, "restaurant");
  assert.equal((await say(r, "/cancel")).state, null);
  assert.match((await say(r, "Cancel")).reply, /Nothing was saved/);
  assert.match((await step(null, { text: "cancel" })).reply, /Nothing to cancel/);
  assert.match((await say(r, "menu")).reply, /Starting over/);
  const fix = await skipReview(await say(r, "Had pasta at Meghana Foods, 6/10")); // full sentence replaces the draft
  assert.match(fix.reply, /Save pasta at Meghana Foods/); assert.match(fix.reply, /6\/10/);
  assert.match((await step(null, { text: "back" })).reply, /won't guess/);
});

test("edit loop: change rating, restaurant, dish and type, then confirm", async () => {
  let r = await skipReview(await step(null, { text: "Had pizza at Toit Indiranagar, 7/10" }));
  let e = await tap(r, "ed"); assert.deepEqual(labels(e), ["Dish", "Restaurant", "Rating", "Review", "Switch to save for later", "Back to summary", "Cancel"]);
  let x = await tap(e, "e3"); x = await tap(x, "r9"); assert.match(x.reply, /9\/10/); assert.equal(x.state!.step, "confirm");
  x = await tap(await tap(x, "ed"), "e2"); x = await say(x, "Meghana Foods"); assert.match(x.reply, /Meghana Foods/); assert.equal(x.state!.step, "confirm");
  x = await tap(await tap(x, "ed"), "e1"); x = await say(x, "Fish Fry"); assert.match(x.reply, /Save Fish Fry at Meghana/);
  x = await tap(await tap(x, "ed"), "e4"); assert.match(x.reply, /save for later/);
  assert.equal(labels(await tap(x, "ed")).includes("Rating"), false);
  const back = await tap(await tap(x, "ed"), "bk"); assert.equal(back.state!.step, "confirm");
  const toAte = await tap(await tap(x, "ed"), "e4"); assert.equal(toAte.state!.step, "rating");
  const editReview = await tap(await tap(r, "ed"), "e5"); assert.equal(editReview.state!.step, "review");
  const yes = await say(await tap(r, "ed"), "no"); assert.equal(yes.state!.step, "edit");
});

test("confirm accepts YES variants, anything else changes nothing", async () => {
  const r = await step(null, { text: "Save pizza at Toit Indiranagar" });
  for (const y of ["YES", "y", "Confirm", "ok", "sure!"]) assert.ok((await say(r, y)).save, y);
  for (const other of ["maybe", "yes please save everything", "8"]) { const x = await say(r, other); assert.equal(x.save, undefined, other); assert.equal(x.state!.step, "confirm"); }
});

test("expiry, stale buttons and replayed buttons never write", async () => {
  const r = await step(null, { text: "Save pizza at Toit Indiranagar" });
  const oldNonce = r.state!.nonce;
  t = NOW + 11 * 60_000;
  try {
    const late = await say(r, "yes"); assert.equal(late.save, undefined); assert.equal(late.state!.step, "kind"); assert.match(late.reply, /expired/);
    const lateTap = await tap(r, "ok"); assert.equal(lateTap.save, undefined); assert.match(lateTap.reply, /expired/);
  } finally { t = NOW; }
  const saved = await tap(r, "ok"); assert.ok(saved.save);
  assert.match((await step(null, { data: `v1:${oldNonce}:ok` })).reply, /out of date/);   // replay after the draft is gone
  const moved = await tap(r, "ed");
  assert.match((await step(moved.state, { data: `v1:${oldNonce}:ok` })).reply, /out of date/); // old button after the prompt moved on
  for (const junk of ["v1:zzzzzzzz:ok", "garbage", "v1:" + moved.state!.nonce + ":ZZ"]) assert.equal((await step(moved.state, { data: junk })).save, undefined);
  assert.equal((await tap(moved, "r5")).save, undefined); // right nonce, wrong step
});

test("existing dish is updated and keeps its note; full list is refused", async () => {
  const ex = [mk()];
  let r = await skipReview(await step(null, { text: "Had pizza at Toit Indiranagar, 9/10" }, ex), ex);
  assert.match(r.reply, /Update pizza/); assert.match(r.reply, /existing note and link are kept/);
  const save = (await tap(r, "ok", ex)).save!;
  assert.deepEqual([save.operation, save.bookmarkId, save.input.note, save.input.rating, save.input.tried], ["update", "b1", "keep me", 9, true]);
  const full = Array.from({ length: 500 }, (_, i) => mk({ id: `b${i}`, name: `Dish ${i}` }));
  r = await step(null, { text: "Save pizza at Toit Indiranagar" }, full);
  const out = await tap(r, "ok", full); assert.equal(out.save, undefined); assert.match(out.reply, /list is full/);
});

test("every prompt fits Telegram limits and leaks no ids", async () => {
  const seen: ConvResult[] = [];
  let r = await step(null, { text: "hello" }); seen.push(r);
  r = await tap(r, "ka"); seen.push(r); r = await say(r, "Pizza"); seen.push(r); r = await say(r, "Toit"); seen.push(r);
  r = await tap(r, "p0"); seen.push(r); r = await tap(r, "r7"); seen.push(r); r = await tap(r, "ed"); seen.push(r);
  for (const x of seen) {
    assert.ok(x.reply.length < 3900);
    for (const b of (x.buttons ?? []).flat()) { assert.ok(Buffer.byteLength(b.data) <= 64, b.data); assert.ok(b.text.length <= 40); assert.match(b.data, /^v1:[a-f0-9]{8}:[a-z0-9.:]{1,12}$/); }
    assert.doesNotMatch(x.reply, /manual:|tg:/);
  }
});

// ---------- engine + database tests (PGlite, migrations applied, nothing external) ----------
async function fixture(run: (f: any) => Promise<void>, opts: EngineOptions = { conversation: true }, cap = 900) {
  const pg = new PGlite();
  for (const file of ["../schema.sql", "../migrations/whatsapp-review.sql", "../migrations/whatsapp-linking.sql", "../migrations/telegram-conversation.sql"]) await pg.exec(readFileSync(new URL(file, import.meta.url), "utf8"));
  await pg.exec("INSERT INTO users(id,created_at) VALUES('alice',1),('bob',1)");
  let time = NOW, seq = 0; const locks: string[][] = [];
  const engine = createWhatsAppExecution({ transaction: r => pg.transaction(tx => { const log: string[] = []; locks.push(log); return r({ query: async (q: string, p?: any[]) => {
    if (q.includes("pg_advisory_xact_lock")) { log.push(p?.[0] ?? "global"); return { rows: [] }; }
    return tx.query(q, p);
  } } as QueryClient); }) }, search, () => time, cap, opts);
  const upd = (from: number, over: any) => ({ update_id: ++seq, ...over(from) });
  const text = (s: string, from = 555111222, id?: number) => parseTelegramText({ update_id: id ?? ++seq, message: { message_id: 1, date: Math.floor(time / 1000), chat: { id: from, type: "private" }, from: { id: from }, text: s } }, "999")!;
  const press = (data: string, from = 555111222, id?: number) => ({ ...parseTelegramText({ update_id: id ?? ++seq, callback_query: { id: "cbq" + seq, from: { id: from }, data, message: { message_id: 5, chat: { id: from, type: "private" } } } }, "999")!, timestamp: time }); // production stamps receipt time
  const link = async (user = "alice", from = 555111222) => {
    const b = await engine.beginLink(user); const code = b.command.slice(5);
    const r = await engine.process(text(`/start ${code}`, from)); const conf = r.reply!.match(/code ([a-f0-9]{48})/)![1];
    assert.equal(await engine.confirmLink(user, `tg:${from}`, conf), true);
  };
  const dishes = async (u = "alice") => (await pg.query<any>("SELECT name,rating,tried FROM food_bookmarks WHERE user_id=$1 ORDER BY name", [u])).rows;
  const nonceOf = async (from = 555111222) => (await pg.query<any>("SELECT state FROM tg_conversations WHERE sender=$1", [`tg:${from}`])).rows[0]?.state.nonce as string | undefined;
  try { await run({ pg, engine, text, press, link, dishes, nonceOf, locks, advance: (ms: number) => { time += ms; }, upd }); } finally { await pg.close(); }
}
const data = (n: string, code: string) => `v1:${n}:${code}`;

test("engine: button flow saves exactly once; confirm replay and retry never double-save", async () => fixture(async f => {
  await f.link();
  let r = await f.engine.process(f.text("hi there")); assert.ok(r.buttons.length);
  r = await f.engine.process(f.press(data(await f.nonceOf(), "ka")));
  r = await f.engine.process(f.text("Pizza")); r = await f.engine.process(f.text("Toit Indiranagar"));
  r = await f.engine.process(f.press(data(await f.nonceOf(), "r8")));
  r = await f.engine.process(f.press(data(await f.nonceOf(), "rk")));
  assert.match(r.reply, /Save Pizza at Toit/); assert.deepEqual(await f.dishes(), []);
  const n = await f.nonceOf();
  r = await f.engine.process(f.press(data(n, "ok"), 555111222, 900));
  assert.match(r.reply, /Saved Pizza at Toit, 8\/10 in the Bhookmark STAGING TEST account\. This is a test, not your bhookmark\.com account\. To reverse within 10 minutes: UNDO [a-f0-9]{48}/);
  assert.equal((await f.dishes()).length, 1);
  const retry = await f.engine.process(f.press(data(n, "ok"), 555111222, 900)); // Telegram redelivery
  assert.equal(retry.duplicate, true); assert.equal((await f.dishes()).length, 1);
  const tapAgain = await f.engine.process(f.press(data(n, "ok"))); // user taps the old button again
  assert.match(tapAgain.reply, /out of date/); assert.equal((await f.dishes()).length, 1);
  assert.equal(await f.nonceOf(), undefined);
  const undo = r.reply.match(/UNDO ([a-f0-9]{48})/)![1];
  assert.match((await f.engine.process(f.text(`UNDO ${undo}`))).reply, /Undone/); assert.deepEqual(await f.dishes(), []);
}));

test("engine: STOP clears the draft, unlinked senders and other senders cannot use someone's buttons", async () => fixture(async f => {
  await f.link();
  await f.engine.process(f.text("hi")); const n = await f.nonceOf();
  const stranger = await f.engine.process(f.press(data(n, "ka"), 777000111));
  assert.match(stranger.reply, /Link your account/); assert.equal(stranger.buttons, undefined);
  assert.equal(await f.nonceOf(), n); // the owner's draft is untouched
  await f.engine.process(f.text("STOP")); assert.equal(await f.nonceOf(), undefined);
  assert.match((await f.engine.process(f.press(data(n, "ka")))).reply, /Link your account/);
  assert.deepEqual(await f.dishes(), []);
}));

test("engine: show my saves and recall still work mid-conversation and keep the draft", async () => fixture(async f => {
  await f.link();
  await f.engine.process(f.text("Save pizza at Toit Indiranagar")); const n = await f.nonceOf();
  assert.match((await f.engine.process(f.text("Show my saves"))).reply, /haven't saved/);
  assert.equal(await f.nonceOf(), n);
  const r = await f.engine.process(f.text("yes")); assert.match(r.reply, /Saved pizza/);
  assert.match((await f.engine.process(f.text("Show my saves"))).reply, /pizza at Toit: unrated/);
  const viaButton = await f.engine.process(f.text("hello")); assert.match((await f.engine.process(f.press(data(await f.nonceOf(), "sw")))).reply, /pizza at Toit/);
  assert.ok(viaButton.buttons);
}));

test("engine: unlinking from the website removes the draft and nothing is written afterwards", async () => fixture(async f => {
  await f.link();
  await f.engine.process(f.text("Save pizza at Toit Indiranagar"));
  await f.engine.unlink("alice");
  assert.equal(await f.nonceOf(), undefined);
  assert.match((await f.engine.process(f.text("yes"))).reply, /Link your account/); assert.deepEqual(await f.dishes(), []);
}));

test("engine: WhatsApp and conversation-off behaviour is unchanged (one-line save writes immediately)", async () => fixture(async f => {
  await f.link();
  assert.match((await f.engine.process(f.text("Save pizza at Toit Indiranagar"))).reply, /^Saved pizza/);
}, {}));

test("engine: monthly cap refuses cleanly, rolls back the whole turn, and exceeds the old 900 CHECK", async () => fixture(async f => {
  await f.link(); // uses 1 reply of 3
  await f.engine.process(f.text("Save pizza at Toit Indiranagar")); // 2
  const r = await f.engine.process(f.text("yes")); // 3
  assert.match(r.reply, /Saved/);
  const before = (await f.dishes()).length;
  const over = await f.engine.process(f.text("Save dosa at Toit Indiranagar")); // cap reached
  assert.equal(over.reply, null);
  assert.equal((await f.pg.query<any>("SELECT reserved FROM whatsapp_review_quota")).rows[0].reserved, 3);
  assert.equal((await f.pg.query<any>("SELECT count(*)::int n FROM tg_conversations")).rows[0].n, 0); // no draft created by a refused turn
  assert.equal((await f.dishes()).length, before);
  await f.pg.exec("UPDATE whatsapp_review_quota SET reserved=900"); // old schema would reject 901
}, { conversation: true }, 3));

test("engine: the 900 limit from whatsapp-review.sql is gone after the migration", async () => fixture(async f => {
  await f.pg.exec("INSERT INTO whatsapp_review_quota(phone_id,month,reserved) VALUES('x','2026-11',20000)");
  assert.equal((await f.pg.query<any>("SELECT reserved FROM whatsapp_review_quota WHERE phone_id='x'")).rows[0].reserved, 20000);
  await assert.rejects(f.pg.exec("UPDATE whatsapp_review_quota SET reserved=-1 WHERE phone_id='x'"));
  await f.pg.exec(readFileSync(new URL("../migrations/telegram-conversation.sql", import.meta.url), "utf8")); // idempotent
}));

test("engine: per-sender limits refuse without mutation, notify once, and never affect other senders", async () => fixture(async f => {
  await f.link("alice", 111); await f.link("bob", 222); // 1 message each in their minute window
  const replies: (string | null)[] = [];
  for (let i = 0; i < 5; i++) replies.push((await f.engine.process(f.text("hi", 111))).reply);
  assert.ok(replies[0] && replies[1]);           // messages 2 and 3 of the window
  assert.match(replies[2]!, /too quickly/);      // 4th: refused with one notice
  assert.equal(replies[3], null); assert.equal(replies[4], null);
  assert.ok((await f.engine.process(f.text("hi", 222))).reply); // bob is unaffected
  const reserved = (await f.pg.query<any>("SELECT reserved FROM whatsapp_review_quota")).rows[0].reserved;
  assert.equal(reserved, 2 + 2 + 1);             // links + accepted ones only; refused turns reserve nothing
  f.advance(61_000);
  assert.ok((await f.engine.process(f.text("hi", 111))).reply); // next minute works again
  const dupe = await f.engine.process(f.text("hi", 111, 7)); const again = await f.engine.process(f.text("hi", 111, 7));
  assert.equal(again.duplicate, true); assert.equal(again.reply, dupe.reply);
}, { conversation: true, senderLimits: { perMinute: 3, perDay: 100 } }));

test("engine: daily limit", async () => fixture(async f => {
  await f.link("alice", 111);
  assert.ok((await f.engine.process(f.text("hi", 111))).reply);
  assert.match((await f.engine.process(f.text("hi", 111))).reply!, /today's message limit/);
  assert.equal((await f.engine.process(f.text("hi", 111))).reply, null);
  f.advance(86_400_000 + 1000); assert.ok((await f.engine.process(f.text("hi", 111))).reply);
}, { conversation: true, senderLimits: { perMinute: 50, perDay: 2 } }));

test("engine (fine locking): parallel senders and duplicates are exact", async () => fixture(async f => {
  const senders = Array.from({ length: 12 }, (_, i) => 1000 + i);
  await pgUsers(f, senders);
  for (const s of senders) await f.link(`u${s}`, s);
  await Promise.all(senders.flatMap(s => [f.engine.process(f.text("Save pizza at Toit Indiranagar", s)), ]));
  await Promise.all(senders.map(s => f.engine.process(f.text("yes", s))));
  for (const s of senders) assert.equal((await f.dishes(`u${s}`)).length, 1);
  // same update delivered 10x at once -> one save
  await f.engine.process(f.text("Save dosa at Toit Indiranagar", 1000, 5000));
  const dup = await Promise.all(Array.from({ length: 10 }, () => f.engine.process(f.text("yes", 1000, 5001))));
  assert.equal(dup.filter((d: any) => !d.duplicate).length, 1);
  assert.equal((await f.dishes("u1000")).length, 2);
  // same user, two different messages in parallel -> both applied, none lost
  await Promise.all([f.engine.process(f.text("Save a at Toit Indiranagar", 1001)), f.engine.process(f.text("Save b at Toit Indiranagar", 1001))]);
  assert.ok((await f.dishes("u1001")).length >= 1);
  const reserved = (await f.pg.query<any>("SELECT reserved FROM whatsapp_review_quota")).rows[0].reserved;
  const events = (await f.pg.query<any>("SELECT count(*)::int n FROM whatsapp_execution_events")).rows[0].n;
  assert.equal(reserved, events); // every accepted turn reserved exactly one reply
}, { conversation: true, locking: "fine" }));
async function pgUsers(f: any, senders: number[]) { for (const s of senders) await f.pg.exec(`INSERT INTO users(id,created_at) VALUES('u${s}',1)`); }

test("engine (fine locking): quota is exact under parallel load", async () => fixture(async f => {
  const senders = Array.from({ length: 6 }, (_, i) => 2000 + i);
  await pgUsers(f, senders);
  // links use the cap too, so link first with a big cap-free path: raise cap by resetting counter
  for (const s of senders) await f.link(`u${s}`, s);
  await f.pg.exec("UPDATE whatsapp_review_quota SET reserved=0");
  const out = await Promise.all(senders.flatMap(s => [1, 2, 3, 4].map(() => f.engine.process(f.text("hi", s)))));
  assert.equal(out.filter((o: any) => o.reply).length, 10);
  assert.equal((await f.pg.query<any>("SELECT reserved FROM whatsapp_review_quota")).rows[0].reserved, 10);
}, { conversation: true, locking: "fine" }, 10));

test("lock order is sender -> global (link ops only) -> user, never user before global", async () => fixture(async f => {
  await f.link("alice", 111);
  f.locks.length = 0;
  await f.engine.process(f.text("hi", 111));                     // normal message
  await f.engine.unlink("alice");                                // website unlink
  const kinds = () => f.locks.map((l: string[]) => l.map(k => k === "global" ? "G" : k.startsWith("sender:") ? "S" : "U").join(""));
  assert.deepEqual(kinds(), ["SU", "GU"]); // normal message, then website unlink
  const b = await f.engine.beginLink("alice"); f.locks.length = 0;
  await f.engine.process(f.text(`/start ${b.command.slice(5)}`, 111)); // link command
  assert.deepEqual(kinds(), ["SG"]);
}, { conversation: true, locking: "fine" }));

test("a database error rolls the turn back, writes nothing, and a retry succeeds once", async () => {
  const pg = new PGlite();
  for (const file of ["../schema.sql", "../migrations/whatsapp-review.sql", "../migrations/whatsapp-linking.sql", "../migrations/telegram-conversation.sql"]) await pg.exec(readFileSync(new URL(file, import.meta.url), "utf8"));
  await pg.exec("INSERT INTO users(id,created_at) VALUES('alice',1); INSERT INTO whatsapp_links(sender,user_id,linked_at) VALUES('tg:111','alice',1)");
  let fail = true;
  const engine = createWhatsAppExecution({ transaction: r => pg.transaction(tx => r({ query: async (q: string, p?: any[]) => {
    if (q.includes("pg_advisory_xact_lock")) return { rows: [] };
    if (fail && q.startsWith("INSERT INTO whatsapp_review_outbox")) throw new Error("injected");
    return tx.query(q, p);
  } } as QueryClient)) }, search, () => NOW, 900, { conversation: true });
  const m = parseTelegramText({ update_id: 1, message: { message_id: 1, date: NOW / 1000, chat: { id: 111, type: "private" }, from: { id: 111 }, text: "Save pizza at Toit Indiranagar" } }, "999")!;
  await assert.rejects(engine.process(m), /injected/);
  assert.equal((await pg.query<any>("SELECT count(*)::int n FROM tg_conversations")).rows[0].n, 0);
  assert.equal((await pg.query<any>("SELECT count(*)::int n FROM whatsapp_execution_events")).rows[0].n, 0);
  fail = false;
  assert.ok((await engine.process(m)).reply);
  assert.equal((await engine.process(m)).duplicate, true);
  await pg.close();
});

// ---------- adapter ----------
const secret = "isolated-telegram-secret-token-32chars";
const cb = (data: any, over: any = {}) => ({ update_id: 9, callback_query: { id: "q1", from: { id: 123456789, is_bot: false }, data, message: { message_id: 4, chat: { id: 123456789, type: "private" } }, ...over } });
test("adapter: button presses are parsed only from the sender's own private chat", () => {
  const m = parseTelegramText(cb("v1:abcdef01:ok"), "999")!;
  assert.deepEqual([m.sender, m.phoneId, m.callback], ["tg:123456789", "tg:999", { data: "v1:abcdef01:ok", queryId: "q1" }]);
  assert.equal(parseTelegramText(cb("x", { message: { message_id: 1, chat: { id: -5, type: "group" } } }), "999"), null);
  assert.equal(parseTelegramText(cb("x", { message: { message_id: 1, chat: { id: 42, type: "private" } } }), "999"), null); // chat is not the presser's own
  assert.equal(parseTelegramText(cb("x", { from: { id: 123456789, is_bot: true } }), "999"), null);
  assert.equal(parseTelegramText(cb(undefined), "999"), null);
  assert.equal(parseTelegramText(cb("x", { message: undefined }), "999"), null);
  assert.throws(() => parseTelegramText(cb("x".repeat(65)), "999"));
});

async function post(opts: any, body: unknown) {
  const app = express(); app.use("/telegram", createTelegramRouter(opts));
  const server = app.listen(0, "127.0.0.1"); await new Promise<void>(r => server.once("listening", r));
  try { return (await fetch(`http://127.0.0.1:${(server.address() as any).port}/telegram/webhook`, { method: "POST", headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": secret }, body: JSON.stringify(body) })).status; }
  finally { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); }
}
test("adapter: failure semantics (never ack unsaved work), buttons and spinner", async () => {
  const sent: any[] = [], answered: string[] = [], errors: unknown[] = [];
  const base = { enabled: true, secretToken: secret, botId: "999", onError: (e: unknown) => errors.push(e), answer: async (id: string) => { answered.push(id); } };
  const btn = [[{ text: "Confirm", data: "v1:abcdef01:ok" }]];
  assert.equal(await post({ ...base, execute: async () => { throw new Error("db down"); } }, cb("v1:abcdef01:ok")), 503);
  assert.equal(answered.length, 0); assert.equal(errors.length, 1);
  const ok = { ...base, execute: async () => ({ reply: "Save?", buttons: btn }), send: async (c: string, t: string, b: any) => { sent.push([c, t, b]); } };
  assert.equal(await post(ok, cb("v1:abcdef01:ok")), 200);
  assert.deepEqual(sent[0], ["123456789", "Save?", btn]); assert.deepEqual(answered, ["q1"]);
  for (const [status, want] of [[400, 200], [403, 200], [429, 503], [502, 503]] as const)
    assert.equal(await post({ ...ok, send: async () => { throw Object.assign(new Error("x"), { status }); } }, cb("v1:abcdef01:ok")), want, String(status));
  assert.equal(await post({ ...ok, send: async () => { throw new Error("network"); } }, cb("v1:abcdef01:ok")), 503);
  assert.equal(await post({ ...ok, answer: async () => { throw new Error("spinner"); } }, cb("v1:abcdef01:ok")), 200); // spinner failure is harmless
});
test("sender: inline keyboard payload matches the Bot API shape and leaks nothing extra", async () => {
  let body: any, url = "";
  const send = createTelegramSender("123456789:" + "A".repeat(35), (async (u: string, init: any) => { url = u; body = JSON.parse(init.body); return { ok: true, status: 200 }; }) as any);
  await send("555", "Pick", [[{ text: "Yes", data: "v1:abcdef01:ok" }, { text: "No", data: "v1:abcdef01:cx" }]]);
  assert.match(url, /\/sendMessage$/);
  assert.deepEqual(body.reply_markup, { inline_keyboard: [[{ text: "Yes", callback_data: "v1:abcdef01:ok" }, { text: "No", callback_data: "v1:abcdef01:cx" }]] });
  await send("555", "Plain"); assert.equal(body.reply_markup, undefined);
  const bad = createTelegramSender("123456789:" + "A".repeat(35), (async () => ({ ok: false, status: 429 })) as any);
  await assert.rejects(bad("555", "x"), (e: any) => e.status === 429 && !/AAAA/.test(e.message));
});

// ---------- review, "rate this", onboarding, receipts, recoverable buttons ----------
const ex1 = (over: Partial<Bookmark> = {}) => mk({ savedAt: NOW - 60_000, ...over });

test("optional private review: Add review stores it in the note; Skip keeps any existing note", async () => {
  let r = await step(null, { text: "Had pizza at Toit Indiranagar, 8/10" });
  const add = await tap(r, "rv"); assert.match(add.reply, /private on your account/);
  const typed = await say(add, "Crisp base, great sauce"); assert.equal(typed.state!.step, "confirm");
  assert.match(typed.reply, /Private review: "Crisp base, great sauce"/);
  assert.equal((await tap(typed, "ok")).save!.input.note, "Crisp base, great sauce");
  assert.equal((await say(add, "x".repeat(2001))).state!.step, "reviewtext");
  assert.equal((await tap(await skipReview(r), "ok")).save!.input.note, ""); // skipping never invents a note
  const ex = [mk({ note: "my old note" })];
  r = await step(null, { text: "Had pizza at Toit Indiranagar, 8/10" }, ex);
  assert.deepEqual(labels(r), ["Keep it", "Replace it", "Clear it", "Back", "Cancel"]); assert.match(r.reply, /my old note/);
  assert.equal((await tap(await tap(r, "rk", ex), "ok", ex)).save!.input.note, "my old note");
  assert.equal((await tap(await tap(r, "rc", ex), "ok", ex)).save!.input.note, "");
  const rep = await say(await tap(r, "rv", ex), "new note", ex); assert.equal((await tap(rep, "ok", ex)).save!.input.note, "new note");
});

test("rate this: uses the current draft or a lone just-saved dish, otherwise asks; never guesses", async () => {
  let r = await say(await tap(await step(null, { text: "x" }), "kl"), "Pizza"); r = await say(r, "Toit Indiranagar");
  const draftRate = await say(r, "rate this"); assert.equal(draftRate.state!.step, "rating"); assert.equal(draftRate.state!.draft.ate, true);
  const one = await step(null, { text: "rate this" }, [ex1()]);
  assert.match(one.reply, /Using Pizza, which you just saved/); assert.equal(one.state!.step, "rating");
  const rated = await tap(one, "r9", [ex1()]); assert.equal(rated.state!.step, "review");
  const two = await step(null, { text: "Rate it" }, [ex1(), ex1({ id: "b2", name: "Pasta" })]);
  assert.equal(two.state!.step, "target"); assert.match(two.reply, /won't guess/);
  const pick = await tap(two, "t1", [ex1(), ex1({ id: "b2", name: "Pasta" })]); assert.equal(pick.state!.draft.dish, "Pasta");
  const old = await step(null, { text: "review this" }, [mk({ savedAt: NOW - 3_600_000 })]); // saved an hour ago: ask
  assert.equal(old.state!.step, "target");
  const rev = await tap(old, "t0", [mk({ savedAt: NOW - 3_600_000, rating: 0, tried: true })]); assert.equal(rev.state!.step, "review");
  assert.match((await step(null, { text: "rate this" })).reply, /haven't saved any dishes/);
});

test("legacy 0 ratings are never rewritten unless the user re-rates", async () => {
  const ex = [mk({ tried: true, rating: 0 })];
  let r = await step(null, { text: "Had pizza at Toit Indiranagar" }, ex); r = await tap(r, "rs", ex); r = await tap(r, "rk", ex);
  assert.equal((await tap(r, "ok", ex)).save!.input.rating, 0);
  const fresh = await tap(await step(null, { text: "Had pizza at Toit Indiranagar" }, ex), "r7", ex);
  assert.equal((await tap(await tap(fresh, "rk", ex), "ok", ex)).save!.input.rating, 7);
});

test("engine: first-time Telegram visitor gets a Link account button; nothing links automatically", async () => fixture(async f => {
  const r = await f.engine.process(f.text("/start"));
  assert.match(r.reply, /Welcome to Bhookmark\. Link your account/);
  assert.deepEqual(r.buttons, [[{ text: "Link account", url: "https://staging.example/link" }]]);
  assert.equal((await f.pg.query<any>("SELECT count(*)::int n FROM whatsapp_links")).rows[0].n, 0);
  assert.equal((await f.pg.query<any>("SELECT count(*)::int n FROM tg_conversations")).rows[0].n, 0);
  assert.match((await f.engine.process(f.press(data("abcdef01", "ka")))).reply, /Welcome to Bhookmark/);
  await f.link(); // owner signs in on the site and confirms the code
  assert.ok((await f.engine.process(f.text("/start"))).buttons.flat().some((b: any) => b.text === "Ate it"));
}, { conversation: true, linkUrl: "https://staging.example/link" }));

test("engine: receipts say staging-test until production is declared; production adds the site button", async () => {
  const run = async (f: any) => { await f.link(); await f.engine.process(f.text("Had pizza at Toit Indiranagar, 8/10")); await f.engine.process(f.press(data(await f.nonceOf(), "rk"))); return f.engine.process(f.press(data(await f.nonceOf(), "ok"))); };
  await fixture(async f => { const r = await run(f); assert.match(r.reply, /STAGING TEST account\. This is a test, not your bhookmark\.com account/); assert.doesNotMatch(r.reply, /logged to your account at bhookmark\.com/); assert.equal(r.buttons, undefined); }, { conversation: true });
  await fixture(async f => { const r = await run(f); assert.match(r.reply, /Saved pizza at Toit, 8\/10\. Your food is logged to your account at bhookmark\.com\. To reverse within 10 minutes/); assert.deepEqual(r.buttons, [[{ text: "Open Bhookmark", url: "https://bhookmark.com/" }]]); }, { conversation: true, production: true, linkUrl: "https://bhookmark.com/" });
});

test("engine: no success receipt when the write fails; the draft stays so the user can retry", async () => {
  const pg = new PGlite();
  for (const file of ["../schema.sql", "../migrations/whatsapp-review.sql", "../migrations/whatsapp-linking.sql", "../migrations/telegram-conversation.sql"]) await pg.exec(readFileSync(new URL(file, import.meta.url), "utf8"));
  await pg.exec("INSERT INTO users(id,created_at) VALUES('alice',1); INSERT INTO whatsapp_links(sender,user_id,linked_at) VALUES('tg:111','alice',1)");
  let fail = false, seq = 0;
  const engine = createWhatsAppExecution({ transaction: r => pg.transaction(tx => r({ query: async (q: string, p?: any[]) => {
    if (q.includes("pg_advisory_xact_lock")) return { rows: [] };
    if (fail && q.startsWith("INSERT INTO food_bookmarks")) throw new Error("injected");
    return tx.query(q, p);
  } } as QueryClient)) }, search, () => NOW, 900, { conversation: true });
  const text = (s: string, id = ++seq) => parseTelegramText({ update_id: id, message: { message_id: 1, date: NOW / 1000, chat: { id: 111, type: "private" }, from: { id: 111 }, text: s } }, "999")!;
  await engine.process(text("Save pizza at Toit Indiranagar"));
  fail = true; await assert.rejects(engine.process(text("yes", 50)), /injected/);
  assert.equal((await pg.query<any>("SELECT count(*)::int n FROM food_bookmarks")).rows[0].n, 0);
  assert.equal((await pg.query<any>("SELECT count(*)::int n FROM tg_conversations")).rows[0].n, 1); // still confirmable
  fail = false; assert.match((await engine.process(text("yes", 50))).reply!, /^Saved pizza/); // Telegram redelivers the same update
  await pg.close();
});

test("engine: a redelivered update gets its buttons back, so the flow is never stranded", async () => fixture(async f => {
  await f.link();
  const first = await f.engine.process(f.text("hello there", 555111222, 800));
  const again = await f.engine.process(f.text("hello there", 555111222, 800));
  assert.equal(again.duplicate, true); assert.equal(again.reply, first.reply); assert.deepEqual(again.buttons, first.buttons);
  assert.ok(again.buttons.flat().length >= 3);
  const typed = await f.engine.process(f.text("menu")); assert.ok(typed.buttons); // MENU always recovers
}));
