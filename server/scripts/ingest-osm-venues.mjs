// Phase 2 Session B: pulls real cafes, restaurants, pubs/bars, and
// bakeries from OpenStreetMap's Overpass API and inserts them into the
// new venues/dishes tables — this is the actual fix for "why isn't a
// real cafe/bar/bakery in the app," for any real venue, not just one
// hand-added example (see PROJECT_STATUS.md's Phase 2 entry).
//
// 2026-09-11 revision: the first version only queried amenity=cafe|
// restaurant|fast_food (missing 321 real pubs/bars/nightclubs entirely)
// and — more importantly — only ever inserted a venue when its cuisine
// tag resolved to a category, silently dropping ~2,700 real, named
// venues from the `venues` table itself. That's wrong for this app's
// actual requirement: a user searching for a specific real place by name
// should find it, whether or not we know what cuisine it serves. Every
// real, named venue now gets a `venues` row unconditionally; a `dishes`
// category stub is created ONLY when a category genuinely resolves —
// category-based Near Me browsing needs that, name search doesn't.
//
// Free, no API key. Verified current fair-use policy: no key required,
// ~100 queries/10MB/day for an app querying it regularly, a User-Agent
// header identifying the app, and caching results rather than querying
// per-request — this script queries ONCE per run and writes what it finds
// to Postgres, which the app then reads from; it does not query Overpass
// on every user request.
//
// Defaults to --dry-run (prints what would happen, writes nothing).
// --commit actually writes. If the target DB doesn't look like a test
// branch, --commit also requires CONFIRM_PROD=1 — the inverse of
// assertTestDatabase.mjs's guard (that one protects a *test* script from
// hitting prod; this one protects an *iterative, still-being-tuned*
// ingestion run from committing to prod by accident mid-iteration).
//
// Usage:
//   npx dotenv -e .env.test -- node scripts/ingest-osm-venues.mjs                 (dry run against test branch)
//   npx dotenv -e .env.test -- node scripts/ingest-osm-venues.mjs --commit        (write to test branch)
//   CONFIRM_PROD=1 npx dotenv -e ../.env.local -- node scripts/ingest-osm-venues.mjs --commit   (write to prod)
import { neon } from "@neondatabase/serverless";
import { nanoid } from "nanoid";
import { isKnownProductionUrl } from "./prodHost.mjs";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}
if (process.env.ALLOW_TEST_DB === "1") {
  await import("./assertTestDatabase.mjs");
}

const COMMIT = process.argv.includes("--commit");
if (COMMIT && isKnownProductionUrl(url) && process.env.CONFIRM_PROD !== "1") {
  console.error(
    "[ingest-osm-venues] --commit was passed against a DATABASE_URL that doesn't look like a test branch.\n" +
      "Refusing to write to what may be production without an explicit CONFIRM_PROD=1.\n" +
      "Run against server/.env.test first (see .env.test.example), or re-run with CONFIRM_PROD=1 once you're sure."
  );
  process.exit(1);
}

const sql = neon(url);

// Central Bangalore bounding box, sized to comfortably cover the existing
// hand-curated venues' spread (Malleshwaram down to Koramangala, across to
// Indiranagar) with room to grow — not the whole metro area, both because
// Overpass's own policy nudges toward modest, well-scoped queries and
// because a first pass should be verifiable by a human, not enormous.
const BBOX = { south: 12.90, west: 77.50, north: 13.02, east: 77.70 };

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
// Per Overpass's fair-use policy: identify the app, not a generic client.
const USER_AGENT = "Bhookmark/1.0 (https://bhookmark.com; food discovery app, low-volume cached queries)";

// amenity=food_court deliberately excluded — it tags a whole building
// (a mall's food court), not a single vendor with one owner/name/cuisine,
// which doesn't fit this schema's one-venue-one-place model. A specific
// stall inside a food court would already be tagged its own amenity if
// mapped separately.
const AMENITY_TYPES = "cafe|restaurant|fast_food|pub|bar|nightclub|biergarten|ice_cream";
const SHOP_TYPES = "bakery|confectionery|pastry";

const QUERY = `
[out:json][timeout:180];
(
  node["amenity"~"^(${AMENITY_TYPES})$"]["name"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});
  way["amenity"~"^(${AMENITY_TYPES})$"]["name"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});
  node["shop"~"^(${SHOP_TYPES})$"]["name"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});
  way["shop"~"^(${SHOP_TYPES})$"]["name"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});
);
out center tags;
`;

// The public instance is documented as frequently overloaded (see the
// Phase 2 plan's own notes on Overpass's fair-use policy) — a 504 here is
// a transient server-side timeout, not a bad query (the same query has
// succeeded before). Retry a few times with a real pause between
// attempts rather than hammering it, per their own "pause before
// retrying" guidance.
async function fetchOverpass(attempt = 1) {
  const res = await fetch(OVERPASS_URL, {
    method: "POST",
    headers: { "User-Agent": USER_AGENT, "Content-Type": "text/plain" },
    body: QUERY,
  });
  if (res.ok) return res.json();
  const text = await res.text().catch(() => "");
  if (attempt < 3 && (res.status === 504 || res.status === 429 || res.status === 502 || res.status === 503)) {
    const waitMs = 30_000 * attempt;
    console.log(`Overpass returned ${res.status} (attempt ${attempt}/3) — waiting ${waitMs / 1000}s before retrying...`);
    await new Promise((r) => setTimeout(r, waitMs));
    return fetchOverpass(attempt + 1);
  }
  throw new Error(`Overpass returned ${res.status}: ${text.slice(0, 300)}`);
}

function elementLatLng(el) {
  if (el.type === "node") return { lat: el.lat, lng: el.lon };
  if (el.center) return { lat: el.center.lat, lng: el.center.lon };
  return null;
}

function elementArea(tags) {
  return tags["addr:suburb"] || tags["addr:neighbourhood"] || tags["addr:city_district"] || "Bengaluru";
}

async function main() {
  console.log(`Querying Overpass for cafes/restaurants/fast_food/pubs/bars/bakeries in bbox ${JSON.stringify(BBOX)}...`);
  const data = await fetchOverpass();
  const elements = data.elements ?? [];
  console.log(`Overpass returned ${elements.length} raw elements.`);

  const aliases = new Map();
  const canonical = new Set();
  // Inlined rather than importing server/src/aliases.ts's resolver against
  // a live DB fetch here, to keep this script runnable with zero other
  // dependencies at dry-run time — mirrors that module's logic exactly.
  const aliasRows = await sql`SELECT alias, category FROM category_aliases`;
  const canonicalRows = await sql`SELECT DISTINCT category FROM category_aliases`;
  for (const r of aliasRows) aliases.set(r.alias, r.category);
  for (const r of canonicalRows) canonical.add(r.category);

  function normalize(term) {
    return term.trim().toLowerCase().replace(/_/g, " ").replace(/\s+/g, " ");
  }
  function resolveCategory(term) {
    const n = normalize(term);
    if (!n) return null;
    if (aliases.has(n)) return aliases.get(n);
    for (const c of canonical) if (c.toLowerCase() === n) return c;
    return null;
  }

  const candidates = [];
  let noName = 0;
  let noLocation = 0;
  const unresolvedCuisines = new Map();

  for (const el of elements) {
    const tags = el.tags ?? {};
    const name = tags.name?.trim();
    if (!name) {
      noName++;
      continue;
    }
    const loc = elementLatLng(el);
    if (!loc) {
      noLocation++;
      continue;
    }
    // cuisine values can be semicolon-separated ("indian;chinese") — try
    // each real cuisine value before the generic amenity/shop-based
    // guess, so an explicit tag always outranks the fallback. amenity/
    // shop values that already default cleanly to one category (cafe ->
    // Coffee, pub/bar/nightclub/biergarten -> Bars & Pubs, ice_cream ->
    // Ice Cream, bakery/confectionery/pastry -> Bakery & Sweets) are
    // tried as fallback candidates via the normal alias table, not
    // hardcoded here, so category_aliases stays the one place spellings
    // live.
    const cuisineValues = (tags.cuisine ?? "").split(";").map((s) => s.trim()).filter(Boolean);
    const typeFallbacks = [tags.amenity, tags.shop].filter(Boolean);
    let category = null;
    for (const c of [...cuisineValues, ...typeFallbacks]) {
      category = resolveCategory(c);
      if (category) break;
    }
    if (!category) {
      const key = cuisineValues.join(";") || `(no cuisine tag, ${tags.amenity ? `amenity=${tags.amenity}` : `shop=${tags.shop}`})`;
      unresolvedCuisines.set(key, (unresolvedCuisines.get(key) ?? 0) + 1);
    }
    candidates.push({
      osmId: `${el.type}/${el.id}`,
      name,
      area: elementArea(tags),
      lat: loc.lat,
      lng: loc.lng,
      category, // may be null — the venue is still inserted, just without a dish/category stub
    });
  }

  const categorized = candidates.filter((c) => c.category);
  const uncategorized = candidates.filter((c) => !c.category);

  console.log(`\nParsed: ${candidates.length} real, named venues total (${categorized.length} with a resolvable category, ${uncategorized.length} without).`);
  console.log(`Skipped entirely (never became a venue): ${noName} with no name, ${noLocation} with no usable location.`);
  console.log(`Uncategorized venues are still inserted and name-searchable — they just won't appear in category-based Near Me browsing until a real log or submission tags them.`);
  if (unresolvedCuisines.size > 0) {
    console.log(`\nTop unresolved cuisine/type values among uncategorized venues (candidates for new category_aliases entries):`);
    [...unresolvedCuisines.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).forEach(([k, n]) => console.log(`  ${n.toString().padStart(3)}  ${k}`));
  }

  const byCategory = new Map();
  for (const c of categorized) byCategory.set(c.category, (byCategory.get(c.category) ?? 0) + 1);
  console.log(`\nBy category:`);
  [...byCategory.entries()].sort((a, b) => b[1] - a[1]).forEach(([cat, n]) => console.log(`  ${n.toString().padStart(3)}  ${cat}`));

  if (!COMMIT) {
    console.log(`\nDry run only — nothing written. Re-run with --commit to insert (and CONFIRM_PROD=1 if targeting prod).`);
    return;
  }

  console.log(`\nCommitting ${candidates.length} venues (${categorized.length} categorized + ${uncategorized.length} uncategorized)...`);
  const now = Date.now();
  let venuesInserted = 0;
  let venuesSkipped = 0;
  let dishesInserted = 0;
  let errors = 0;

  for (const c of candidates) {
    try {
      // ON CONFLICT ... DO UPDATE (a harmless updated_at bump) rather than
      // DO NOTHING, specifically so this always returns the venue's id —
      // DO NOTHING was silently skipping the dish-stub step below on every
      // re-run for a venue that already existed, which is exactly the
      // re-run-to-backfill-a-newly-resolved-category case this script
      // needs to support (a venue ingested before an alias existed for
      // its cuisine should pick up a dish stub the next time it resolves,
      // not stay uncategorized forever).
      const venueRows = await sql`
        INSERT INTO venues (id, name, area, city, lat, lng, source, osm_id, created_at, updated_at)
        VALUES (${nanoid()}, ${c.name}, ${c.area}, 'Bengaluru', ${c.lat}, ${c.lng}, 'osm', ${c.osmId}, ${now}, ${now})
        ON CONFLICT (osm_id) WHERE osm_id IS NOT NULL DO UPDATE SET updated_at = ${now}
        RETURNING id, (xmax = 0) AS was_inserted`;
      if (venueRows[0].was_inserted) venuesInserted++;
      else venuesSkipped++;
      if (!c.category) continue; // no resolved category — venue exists and is name-searchable, no dish stub
      const venueId = venueRows[0].id;
      // A bare category-level stub, not a fabricated specific dish — OSM
      // tells us "this place serves Coffee," never "this place serves a
      // Filter Coffee for ₹40." Real dish-level detail comes from real
      // logs/submissions once someone actually visits.
      const dishRows = await sql`
        INSERT INTO dishes (id, venue_id, category, subtype, name, source, created_at, updated_at)
        VALUES (${nanoid()}, ${venueId}, ${c.category}, 'General', ${c.name}, 'osm', ${now}, ${now})
        ON CONFLICT (venue_id, category, subtype, lower(name)) WHERE status <> 'merged' DO NOTHING
        RETURNING id`;
      if (dishRows.length > 0) dishesInserted++;
    } catch (err) {
      errors++;
      console.log(`  error inserting "${c.name}" (${c.osmId}): ${err.message?.slice(0, 150)}`);
    }
  }

  console.log(`\nDone. ${venuesInserted} venues inserted, ${venuesSkipped} already present (osm_id match), ${dishesInserted} dish stubs created, ${errors} errors.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
