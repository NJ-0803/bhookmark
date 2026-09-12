// Phase 2 Session C (scoped, quick version, 2026-09-12): brings the 12
// original catalog.ts dishes' real diet/allergen tags into the new
// venues/dishes schema, as a prerequisite for Session E (swapping
// recommend.ts off the static catalog). Without this, none of the 4,907
// real OSM venues have any dish_attributes at all, and recommend.ts is
// designed to exclude unknown-diet dishes rather than guess — meaning a
// vegetarian/vegan/Jain/allergen user would see zero recommendations
// until real attribute data exists somewhere in the new schema.
//
// Deliberately NOT attempting to merge these into an existing OSM venue
// row. A first attempt at coordinate-based matching (old venues.ts has
// approximate, hand-entered coordinates — its own comment says "not
// surveyed storefront-precise") found candidates up to 4.6km away for
// some names ("Empire Restaurant", "Toscano") — almost certainly a
// *different* real place with the same name elsewhere in the city, not
// the intended venue. Force-matching on a loosened radius would risk
// attaching a real dietary claim (e.g. "serves mutton biryani,
// non-veg") to the wrong physical location — exactly the kind of
// fabricated-confidence bug this project has spent multiple sessions
// removing. Re-seeding these 12 as their own venues at their known
// (if approximate) coordinates is honest and low-risk; it does mean the
// same real place may show up twice for now (once via OSM with no diet
// data, once via this seed with it) until a real human-reviewed merge
// pass happens later — a knowingly-accepted, visible tradeoff, not a
// silent one.
//
// Defaults to --dry-run. --commit requires CONFIRM_PROD=1 against
// anything that isn't a recognized test branch.
import { neon } from "@neondatabase/serverless";
import { nanoid } from "nanoid";
import { isKnownProductionUrl } from "./prodHost.mjs";
import { CATALOG } from "../src/catalog.ts";
import { VENUES } from "../src/venues.ts";

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
  console.error("[migrate-catalog-diet-data] --commit against what looks like production needs CONFIRM_PROD=1. Run against .env.test first.");
  process.exit(1);
}

const sql = neon(url);

async function main() {
  console.log(`Re-seeding ${CATALOG.length} old catalog dishes (with real diet/allergen tags) into the new schema...\n`);

  const venuesById = new Map();
  for (const dish of CATALOG) {
    const oldVenue = VENUES.find((v) => v.name === dish.venue);
    if (!oldVenue) {
      console.log(`  SKIP  ${dish.name} @ ${dish.venue} — no coordinates found in the old venues.ts array`);
      continue;
    }
    if (!venuesById.has(dish.venue)) venuesById.set(dish.venue, { oldVenue, dishes: [] });
    venuesById.get(dish.venue).dishes.push(dish);
  }

  console.log(`${venuesById.size} venues, ${CATALOG.length} dishes to seed.`);
  for (const [name, { dishes }] of venuesById) {
    console.log(`  ${name}: ${dishes.map((d) => d.name).join(", ")}`);
  }

  if (!COMMIT) {
    console.log(`\nDry run only — nothing written. Re-run with --commit to insert (and CONFIRM_PROD=1 if targeting prod).`);
    return;
  }

  console.log(`\nCommitting...`);
  const now = Date.now();
  let venuesCreated = 0, dishesCreated = 0, attributesCreated = 0;

  for (const [name, { oldVenue, dishes }] of venuesById) {
    try {
      const venueRows = await sql`
        INSERT INTO venues (id, name, area, city, lat, lng, source, created_at, updated_at)
        VALUES (${nanoid()}, ${name}, ${oldVenue.area}, 'Bengaluru', ${oldVenue.lat}, ${oldVenue.lng}, 'seed', ${now}, ${now})
        ON CONFLICT (lower(name), lower(area), round(lat::numeric, 3), round(lng::numeric, 3)) WHERE status <> 'merged' DO NOTHING
        RETURNING id`;
      let venueId;
      if (venueRows.length > 0) {
        venueId = venueRows[0].id;
        venuesCreated++;
      } else {
        const existing = await sql`SELECT id FROM venues WHERE lower(name) = lower(${name}) AND source = 'seed' LIMIT 1`;
        if (!existing[0]) {
          console.log(`  error: couldn't create or find seed venue for "${name}"`);
          continue;
        }
        venueId = existing[0].id;
      }

      for (const dish of dishes) {
        const dishId = nanoid();
        const dishRows = await sql`
          INSERT INTO dishes (id, venue_id, category, subtype, name, source, created_at, updated_at)
          VALUES (${dishId}, ${venueId}, ${dish.category}, ${dish.subtype}, ${dish.name}, 'seed-catalog', ${now}, ${now})
          ON CONFLICT (venue_id, category, subtype, lower(name)) WHERE status <> 'merged' DO NOTHING
          RETURNING id`;
        if (dishRows.length === 0) {
          console.log(`  skip (already exists): ${dish.name}`);
          continue;
        }
        dishesCreated++;
        const attributes = [...dish.dietTags.map((t) => `diet:${t}`), ...dish.allergens.map((a) => `allergen:${a}`)];
        for (const attribute of attributes) {
          await sql`
            INSERT INTO dish_attributes (dish_id, attribute, source, checked_at)
            VALUES (${dishId}, ${attribute}, 'seed-catalog', ${now})
            ON CONFLICT (dish_id, attribute, source) DO NOTHING`;
          attributesCreated++;
        }
      }
    } catch (err) {
      console.log(`  error on "${name}": ${err.message?.slice(0, 150)}`);
    }
  }

  console.log(`\nDone. ${venuesCreated} venues created, ${dishesCreated} dishes created, ${attributesCreated} attribute rows created.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
