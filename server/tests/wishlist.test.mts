import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import express from "express";
import type { Server } from "node:http";
import { bookmarkSchema, createBookmarkStore, type sql } from "../src/bookmarks";
import { searchGoogle, getRestaurant, searchLocal } from "../src/restaurants";

process.env.JWT_ACCESS_SECRET = "isolated-test-access-secret";
process.env.JWT_REFRESH_SECRET = "isolated-test-refresh-secret";
const { createBookmarksRouter } = await import("../src/routes/bookmarks");
const { issueAccessToken } = await import("../src/auth");
const pg = new PGlite();
const schema = readFileSync(new URL("../schema.sql", import.meta.url), "utf8");
const input = { restaurantId: "osm:branch-a", restaurantName: "A restaurant", address: "Indiranagar, Bengaluru", name: "Pizza", note: "", referenceUrl: "", tried: false, rating: null };

// Runs the production store's actual parameterized SQL against PostgreSQL.
function connect() {
  const tag = (strings: TemplateStringsArray, ...params: unknown[]) => {
    const text = strings.reduce((acc, s, i) => acc + (i ? `$${i}` : "") + s, "");
    return { text, params, then: (resolve: (r: unknown) => unknown, reject: (e: unknown) => unknown) => pg.query(text, params).then((r) => resolve(r.rows), reject) };
  };
  tag.transaction = async (queries: { text: string; params: unknown[] }[]) => pg.transaction(async (tx) => {
    const result: unknown[][] = [];
    for (const q of queries) result.push((await tx.query(q.text, q.params)).rows);
    return result;
  });
  return tag;
}
const store = createBookmarkStore(connect as unknown as typeof sql);
let server: Server;
let base: string;
const token = (id: string) => issueAccessToken(id, "user", Math.floor(Date.now() / 1000), `${id}-device`);
const nativeFetch = globalThis.fetch;

before(async () => {
  await pg.exec(schema);
  await pg.exec("INSERT INTO users (id, created_at) VALUES ('alice', 1), ('bob', 1)");
  const app = express(); app.use(express.json()); app.use("/bookmarks", createBookmarksRouter(store));
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string"); base = `http://127.0.0.1:${address.port}`;
});
after(async () => { globalThis.fetch = nativeFetch; delete process.env.GOOGLE_PLACES_API_KEY; await new Promise<void>((resolve) => server.close(() => resolve())); await pg.close(); });
async function request(method: string, path: string, user?: string, body?: unknown) {
  return nativeFetch(`${base}${path}`, { method, headers: { "Content-Type": "application/json", ...(user ? { Authorization: `Bearer ${token(user)}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
}

test("manual rating stays null until chosen; zero is valid", () => {
  assert.equal(bookmarkSchema.parse(input).rating, null);
  assert.equal(bookmarkSchema.parse({ ...input, tried: true, rating: 0 }).rating, 0);
  for (const rating of [-1, 11, 7.3]) assert.equal(bookmarkSchema.safeParse({ ...input, tried: true, rating }).success, false);
  assert.equal(bookmarkSchema.safeParse({ ...input, rating: 8 }).success, false);
  assert.equal(bookmarkSchema.safeParse({ ...input, googleRating: 4.5 }).success, false);
  assert.equal(bookmarkSchema.safeParse({ ...input, referenceUrl: "javascript:alert(1)" }).success, false);
});

test("schema and legacy-saves migration are rerunnable without inventing ratings", async () => {
  await pg.exec("INSERT INTO saved_dishes (user_id, dish_key, name, venue, area, created_at) VALUES ('alice', 'dosa|ctr', 'Dosa', 'CTR', 'Malleshwaram', 1)");
  await pg.exec(schema); await pg.exec(schema);
  const rows = await store.list("alice");
  assert.equal(rows.length, 1); assert.equal(rows[0].name, "Dosa"); assert.equal(rows[0].rating, null); assert.equal(rows[0].tried, false);
  await store.remove("alice", rows[0].id);
  await pg.exec(schema);
  assert.equal((await store.list("alice")).length, 0, "removed legacy bookmarks must not reappear on redeploy");
});

test("save/edit preserves manual ratings and distinguishes branches", async () => {
  const a = await store.save("alice", "a", input); assert.ok(a);
  const again = await store.update("alice", "a", { ...input, name: "  PIZZA  ", tried: true, rating: 8.5, note: "Order again" }); assert.equal(again?.id, "a"); assert.equal(again?.rating, 8.5);
  const duplicate = await store.save("alice", "unused", input); assert.equal(duplicate?.rating, 8.5); assert.equal(duplicate?.note, "Order again");
  const otherBranch = await store.save("alice", "b", { ...input, restaurantId: "osm:branch-b" }); assert.equal(otherBranch?.id, "b");
  assert.equal((await store.list("bob")).length, 0);
  assert.equal(await store.remove("bob", "a"), false);
  assert.equal(await store.remove("alice", "a"), true);
});

test("PostgreSQL enforces rating/tried integrity independently of the API", async () => {
  await assert.rejects(() => pg.exec("UPDATE food_bookmarks SET tried=false, rating=8 WHERE id='b'"));
});

test("authenticated CRUD: own rows only, input validation, and persistence", async () => {
  assert.equal((await request("GET", "/bookmarks")).status, 401);
  assert.equal((await request("POST", "/bookmarks", "bob", { ...input, rating: 9 })).status, 400);
  assert.equal((await request("POST", "/bookmarks", "bob", { ...input, name: "   " })).status, 400);
  const response = await request("POST", "/bookmarks", "bob", { ...input, tried: true, rating: 0 });
  assert.equal(response.status, 200); const saved = (await response.json()).bookmark;
  const reload = await (await request("GET", "/bookmarks", "bob")).json(); assert.equal(reload.bookmarks[0].rating, 0);
  assert.equal((await request("PATCH", `/bookmarks/${saved.id}`, "alice", { ...input, tried: true, rating: 9 })).status, 404);
  const edit = await request("PATCH", `/bookmarks/${saved.id}`, "bob", { ...input, tried: true, rating: 9 }); assert.equal(edit.status, 200); assert.equal((await edit.json()).bookmark.rating, 9);
  assert.equal((await request("DELETE", `/bookmarks/${saved.id}`, "alice")).status, 404);
  assert.equal((await request("DELETE", `/bookmarks/${saved.id}`, "bob")).status, 200);
});

test("save limit permits edits and rejects new items", async () => {
  await pg.exec("INSERT INTO food_bookmarks(id, user_id, restaurant_id, restaurant_name, name, created_at) SELECT 'cap-'||n, 'bob', 'osm:cap', 'Cap', 'Dish '||n, 1 FROM generate_series(1,500) n");
  assert.equal(await store.save("bob", "overflow", { ...input, restaurantId: "osm:cap" }), null);
  const edited = await store.update("bob", "cap-1", { ...input, restaurantId: "osm:cap", name: "Dish 1", tried: true, rating: 9 }); assert.equal(edited?.rating, 9);
  assert.equal((await request("POST", "/bookmarks", "bob", input)).status, 409);
});

test("live discovery requests photos but never imported ratings; bounds and pagination apply", async () => {
  process.env.GOOGLE_PLACES_API_KEY = "test-key";
  let observed = false;
  globalThis.fetch = async (url, options) => {
    assert.match(String(url), /places:searchText/); const headers = options?.headers as Record<string, string>;
    assert.ok(!headers["X-Goog-FieldMask"].includes("rating")); assert.ok(headers["X-Goog-FieldMask"].includes("photos"));
    const body = JSON.parse(String(options?.body)); assert.equal(body.pageToken, "page-2"); assert.ok(body.locationRestriction.rectangle); observed = true;
    return Response.json({ places: [
      { id: "blr", displayName: { text: "Restaurant A" }, types: ["restaurant"], location: { latitude: 12.97, longitude: 77.59 }, rating: 4.9, photos: [{ name: "places/blr/photos/abc", googleMapsUri: "https://maps.google.com/photo", authorAttributions: [{ displayName: "Photographer", uri: "https://maps.google.com/author" }] }] },
      { id: "other", types: ["restaurant"], location: { latitude: 28.6, longitude: 77.2 } },
      { id: "hotel", types: ["lodging"], location: { latitude: 12.97, longitude: 77.59 } },
    ], nextPageToken: "page-3" });
  };
  try {
    const r = await searchGoogle("pizza", "bengaluru", "page-2"); assert.ok(observed); assert.equal(r.restaurants.length, 1); assert.equal(r.nextPageToken, "page-3");
    const place = r.restaurants[0]; assert.equal(place.photos[0].authors[0].name, "Photographer"); assert.ok(!("rating" in place)); assert.ok(!JSON.stringify(place).includes("test-key"));
  } finally { globalThis.fetch = nativeFetch; }
});

test("unconfigured provider fails honestly and malformed place IDs cannot trigger requests", async () => {
  delete process.env.GOOGLE_PLACES_API_KEY;
  await assert.rejects(() => searchGoogle("coffee", "bengaluru"));
  assert.equal(await getRestaurant("google:../../secrets"), null);
});

test("local search includes uncategorized restaurants, distinct branches and suburbs, with pagination", async () => {
  await pg.exec(`INSERT INTO venues (id, name, area, lat, lng, source, created_at, updated_at)
    SELECT 'venue-'||n, 'Cafe '||n, 'Whitefield', 12.97, 77.75 + n * 0.001, 'osm', 1, 1 FROM generate_series(1,25) n`);
  const first = await searchLocal("Whitefield", "bengaluru", 0, connect as unknown as typeof sql);
  const second = await searchLocal("Whitefield", "bengaluru", 20, connect as unknown as typeof sql);
  assert.equal(first.restaurants.length, 20); assert.equal(first.nextOffset, 20);
  assert.equal(second.restaurants.length, 5); assert.equal(second.nextOffset, null);
  assert.equal(new Set([...first.restaurants, ...second.restaurants].map((r) => r.id)).size, 25);
  assert.ok(first.restaurants.every((r) => r.photos.length === 0));
  assert.equal((await searchLocal("%", "bengaluru", 0, connect as unknown as typeof sql)).restaurants.length, 0);
});

test("removed feature APIs are unreachable", async () => {
  const { default: app } = await import("../src/app");
  const s = app.listen(0, "127.0.0.1"); await new Promise<void>((resolve) => s.once("listening", resolve));
  const address = s.address(); assert.ok(address && typeof address !== "string");
  try { for (const path of ["/logs", "/dishes/score", "/taste/status", "/rooms", "/circles", "/recommendations/next", "/notifications", "/saves"]) {
    assert.equal((await nativeFetch(`http://127.0.0.1:${address.port}${path}`)).status, 404, path);
  } } finally { await new Promise<void>((resolve) => s.close(() => resolve())); }
});


test("verified photographs belong only to the exact branch and featured venues precede numeric names", async () => {
  await pg.exec(`INSERT INTO venues (id, osm_id, name, area, lat, lng, source, created_at, updated_at) VALUES
    ('verified-mtr', 'node/429833271', 'Mavalli Tiffin Rooms', 'Lalbagh Road', 12.9551683, 77.5855225, 'osm', 1, 1),
    ('other-mtr', 'node/1675540997', 'Mavalli Tiffin Rooms', 'Bengaluru', 12.9721761, 77.6009542, 'osm', 1, 1),
    ('numeric', 'node/test-numeric', '080 Lounge', 'Bengaluru', 12.97, 77.60, 'osm', 1, 1)`);
  const defaultPage = await searchLocal('', "bengaluru", 0, connect as unknown as typeof sql);
  assert.equal(defaultPage.restaurants[0].id, 'osm:verified-mtr');
  assert.ok(defaultPage.restaurants[0].photos[0].url.endsWith('/mtr-lalbagh.jpg'));
  const branches = await searchLocal('Mavalli', "bengaluru", 0, connect as unknown as typeof sql);
  assert.equal(branches.restaurants.length, 2);
  const other = branches.restaurants.find((r) => r.id === 'osm:other-mtr')!;
  assert.equal(other.photos.length, 0); assert.equal(other.address, 'Bengaluru');
  const acronym = await searchLocal('MTR', "bengaluru", 0, connect as unknown as typeof sql);
  assert.ok(acronym.restaurants.some((r) => r.id === 'osm:verified-mtr'));
  const numeric = await searchLocal('080', "bengaluru", 0, connect as unknown as typeof sql);
  assert.equal(numeric.restaurants[0].name, '080 Lounge');
});

test("luxury picks lead without ratings and numeric chain names retain distinct corrected branches", async () => {
  await pg.exec(`INSERT INTO venues (id, osm_id, name, area, lat, lng, source, created_at, updated_at) VALUES
    ('luxury-karavalli', 'node/3761073062', 'Karavalli', 'Residency Road', 12.9720694, 77.6089097, 'osm', 1, 1),
    ('luxury-lupa', 'node/10591455581', 'LUPA', 'MG Road', 12.9755984, 77.6045793, 'osm', 1, 1),
    ('pub-jp', 'node/11303671252', '1522', 'Bengaluru', 12.9062943, 77.5758493, 'osm', 1, 1),
    ('pub-kor', 'node/3782893189', '1522', 'Bengaluru', 12.9342864, 77.6301111, 'osm', 1, 1)`);
  const page = await searchLocal('', "bengaluru", 0, connect as unknown as typeof sql);
  assert.deepEqual(page.restaurants.slice(0, 2).map((r) => r.name), ['Karavalli', 'LUPA']);
  assert.equal(page.restaurants[0].category, 'Fine dining');
  const pubs = await searchLocal('1522', "bengaluru", 0, connect as unknown as typeof sql);
  assert.equal(pubs.restaurants.length, 2);
  assert.deepEqual(new Set(pubs.restaurants.map((r) => r.name)), new Set(['1522 The Pub · JP Nagar', '1522 The Pub · Koramangala']));
  const branch = await searchLocal('Koramangala', "bengaluru", 0, connect as unknown as typeof sql);
  assert.ok(branch.restaurants.some((r) => r.id === 'osm:pub-kor'));
  assert.ok(!branch.restaurants.some((r) => r.id === 'osm:pub-jp'));
});

test("community promotion needs three real manual raters, counts people once, and responds to edits", async () => {
  await pg.exec("INSERT INTO users (id, created_at) VALUES ('rank-alice', 1), ('rank-bob', 1), ('rank-charlie', 1)");
  const inputFor = (id: string, name: string, rating: number | null, tried = true) => ({ ...input, restaurantId: `osm:${id}`, restaurantName: id, name, tried, rating });
  await store.save('rank-alice', 'pop-1', inputFor('venue-1', 'First', 0));
  await store.save('rank-alice', 'pop-2', inputFor('venue-1', 'Second', 9));
  await store.save('rank-bob', 'pop-3', inputFor('venue-2', 'Only', 7));
  await store.save('rank-bob', 'unrated', inputFor('luxury-karavalli', 'Unrated', null, false));
  let results = (await searchLocal('', "bengaluru", 0, connect as unknown as typeof sql)).restaurants;
  assert.equal(results.find((r) => r.id === 'osm:venue-1')!.ratingCount, 1); // zero counts, two dishes don't double-count
  assert.equal(results.find((r) => r.id === 'osm:luxury-karavalli')!.ratingCount, 0);
  assert.equal(results[0].id, 'osm:luxury-karavalli');
  await store.save('rank-alice', 'pop-4', inputFor('venue-2', 'Another', 6));
  assert.equal((await searchLocal('', "bengaluru", 0, connect as unknown as typeof sql)).restaurants[0].id, 'osm:luxury-karavalli');
  await store.save('rank-charlie', 'pop-5', inputFor('venue-2', 'Third person', 8));
  results = (await searchLocal('', "bengaluru", 0, connect as unknown as typeof sql)).restaurants;
  assert.equal(results[0].id, 'osm:venue-2'); assert.equal(results[0].ratingCount, 3);
  assert.ok(!('rating' in results[0])); assert.ok(!('userId' in results[0])); assert.ok(!('note' in results[0]));
  await store.update('rank-alice', 'pop-4', inputFor('venue-2', 'Another', null));
  assert.equal((await searchLocal('', "bengaluru", 0, connect as unknown as typeof sql)).restaurants[0].id, 'osm:luxury-karavalli');
  await store.remove('rank-bob', 'pop-3');
  results = (await searchLocal('', "bengaluru", 0, connect as unknown as typeof sql)).restaurants;
  assert.equal(results.find((r) => r.id === 'osm:venue-2')!.ratingCount, 1);
  assert.equal(results[0].id, 'osm:luxury-karavalli');
});

test("city filter keeps Patiala and Bengaluru catalogs strictly separate", async () => {
  const { coverage } = await import("../src/restaurants");
  await pg.exec(`INSERT INTO venues (id, osm_id, name, area, city, lat, lng, source, created_at, updated_at) VALUES
    ('patiala-mojave', 'node/pat-1', 'Mojave - Artisanal Kitchen & Bar', 'Bhupindra Road', 'Patiala', 30.3436, 76.3790, 'osm', 1, 1),
    ('patiala-jaggi', 'node/pat-2', 'Jaggi''s Restaurant', 'Adalat Bazaar', 'Patiala', 30.3250, 76.3950, 'osm', 1, 1),
    ('misfiled', 'node/pat-3', 'Wrongly Filed Cafe', 'Patiala', 'Patiala', 12.97, 77.59, 'osm', 1, 1)`);
  const patiala = await searchLocal('', "patiala", 0, connect as unknown as typeof sql);
  assert.deepEqual(new Set(patiala.restaurants.map((r) => r.id)), new Set(['osm:patiala-mojave', 'osm:patiala-jaggi']), "only in-region Patiala venues");
  assert.ok(patiala.restaurants.every((r) => r.city === 'Patiala'));
  const bengaluru = await searchLocal('', "bengaluru", 0, connect as unknown as typeof sql);
  assert.ok(!bengaluru.restaurants.some((r) => r.city === 'Patiala'), "Bengaluru search must never include Patiala venues");
  assert.ok(!bengaluru.restaurants.some((r) => r.id === 'osm:misfiled'), "a Patiala-labelled row with Bengaluru coordinates belongs to neither catalog view");
  const named = await searchLocal('Mojave', "bengaluru", 0, connect as unknown as typeof sql);
  assert.equal(named.restaurants.length, 0, "a Patiala name must not surface in a Bengaluru search");
  const direct = await getRestaurant('osm:patiala-mojave', connect as unknown as typeof sql);
  assert.equal(direct?.city, 'Patiala', "direct restaurant links work for both cities");
  const covPat = await coverage("patiala", connect as unknown as typeof sql);
  assert.equal(covPat.city, 'Patiala'); assert.equal(covPat.catalogCount, 2, "misfiled coordinates are excluded from the city count");
  const covBlr = await coverage("bengaluru", connect as unknown as typeof sql);
  assert.equal(covBlr.city, 'Bengaluru');
  assert.ok(covBlr.catalogCount > covPat.catalogCount);
  assert.deepEqual(covPat.cities.map((c) => c.key), ['bengaluru', 'patiala']);
});
