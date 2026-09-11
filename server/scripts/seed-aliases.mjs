// Seeds category_aliases / dish_name_aliases (Phase 2, 2026-09-11).
// Idempotent (ON CONFLICT DO NOTHING) — safe to re-run. Run with:
//   npx dotenv -e .env.test -- node scripts/seed-aliases.mjs   (test branch)
//   npx dotenv -e ../.env.local -- node scripts/seed-aliases.mjs   (prod)
import { neon } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}
if (process.env.ALLOW_TEST_DB === "1") {
  await import("./assertTestDatabase.mjs");
}
const sql = neon(url);

// Canonical category list going forward — the existing 7 (already live in
// src/data/dishes.ts's CATEGORIES) plus 6 new ones covering what Bangalore
// actually searches for that the old hardcoded list had no category for at
// all (per the Phase 2 plan). Not wiring these into the frontend/routes
// yet — that's the next session — this just makes sure the vocabulary
// exists and is alias-resolvable before anything depends on it.
const CATEGORY_ALIASES = [
  // Coffee — the exact rename that broke Near Me search
  ["filter coffee", "Coffee"],
  ["kaapi", "Coffee"],
  ["filter kaapi", "Coffee"],
  ["degree coffee", "Coffee"],
  ["cold coffee", "Coffee"],
  ["cafe", "Coffee"],

  // Dosa & Idli
  ["dosa", "Dosa & Idli"],
  ["dose", "Dosa & Idli"],
  ["idli", "Dosa & Idli"],
  ["idly", "Dosa & Idli"],

  // Biryani
  ["biriyani", "Biryani"],
  ["briyani", "Biryani"],
  ["biriani", "Biryani"],

  // Burger / Pizza / Momos / Ice Cream — plurals and common variants
  ["burgers", "Burger"],
  ["pizzas", "Pizza"],
  ["momo", "Momos"],
  ["dimsum", "Momos"],
  ["dim sum", "Momos"],
  ["ice-cream", "Ice Cream"],
  ["icecream", "Ice Cream"],
  ["gelato", "Ice Cream"],

  // New: Street Food & Chaat
  ["pav bhaji", "Street Food & Chaat"],
  ["bhel puri", "Street Food & Chaat"],
  ["vada pav", "Street Food & Chaat"],
  ["vadapav", "Street Food & Chaat"],
  ["pani puri", "Street Food & Chaat"],
  ["panipuri", "Street Food & Chaat"],
  ["golgappa", "Street Food & Chaat"],
  ["gol gappa", "Street Food & Chaat"],
  ["chaat", "Street Food & Chaat"],
  ["street food", "Street Food & Chaat"],

  // New: North Indian
  ["north indian", "North Indian"],
  ["punjabi", "North Indian"],
  ["thali", "North Indian"],
  ["roti", "North Indian"],
  ["paneer", "North Indian"],

  // New: South Indian Meals & Tiffin (broader than Dosa & Idli)
  ["south indian", "South Indian Meals & Tiffin"],
  ["tiffin", "South Indian Meals & Tiffin"],
  ["meals", "South Indian Meals & Tiffin"],
  ["uttapam", "South Indian Meals & Tiffin"],
  ["pongal", "South Indian Meals & Tiffin"],
  ["vada", "South Indian Meals & Tiffin"],

  // New: Chinese / Indo-Chinese
  ["chinese", "Chinese"],
  ["indo-chinese", "Chinese"],
  ["indo chinese", "Chinese"],
  ["manchurian", "Chinese"],
  ["noodles", "Chinese"],
  ["hakka", "Chinese"],
  ["fried rice", "Chinese"],

  // New: Rolls & Kebabs
  ["rolls", "Rolls & Kebabs"],
  ["kebab", "Rolls & Kebabs"],
  ["kebabs", "Rolls & Kebabs"],
  ["kathi roll", "Rolls & Kebabs"],
  ["frankie", "Rolls & Kebabs"],

  // New: Bakery & Sweets
  ["bakery", "Bakery & Sweets"],
  ["sweets", "Bakery & Sweets"],
  ["mithai", "Bakery & Sweets"],
  ["cake", "Bakery & Sweets"],
  ["pastry", "Bakery & Sweets"],
  ["bakes", "Bakery & Sweets"],
  ["confectionery", "Bakery & Sweets"],

  // New (2026-09-11): Bars & Pubs — a real, sizable gap found after the
  // first OSM ingestion only queried amenity=cafe|restaurant|fast_food
  // and silently excluded amenity=pub|bar|nightclub entirely (321 real
  // venues in central Bangalore alone).
  ["pub", "Bars & Pubs"],
  ["pubs", "Bars & Pubs"],
  ["bar", "Bars & Pubs"],
  ["bars", "Bars & Pubs"],
  ["nightclub", "Bars & Pubs"],
  ["biergarten", "Bars & Pubs"],
  ["brewery", "Bars & Pubs"],
  ["brewpub", "Bars & Pubs"],
  ["taproom", "Bars & Pubs"],
  ["cocktail bar", "Bars & Pubs"],
];

const DISH_NAME_ALIASES = [
  ["dose", "dosa"],
  ["idly", "idli"],
  ["biriyani", "biryani"],
  ["briyani", "biryani"],
  ["biriani", "biryani"],
  ["panipuri", "pani puri"],
  ["golgappa", "pani puri"],
  ["gol gappa", "pani puri"],
  ["vadapav", "vada pav"],
  ["manchuria", "manchurian"],
];

async function main() {
  let inserted = 0;
  for (const [alias, category] of CATEGORY_ALIASES) {
    const rows = await sql`
      INSERT INTO category_aliases (alias, category) VALUES (${alias}, ${category})
      ON CONFLICT (alias) DO NOTHING
      RETURNING alias`;
    if (rows.length) inserted++;
  }
  console.log(`category_aliases: ${inserted} new / ${CATEGORY_ALIASES.length} total`);

  let insertedNames = 0;
  for (const [alias, token] of DISH_NAME_ALIASES) {
    const rows = await sql`
      INSERT INTO dish_name_aliases (alias, canonical_token) VALUES (${alias}, ${token})
      ON CONFLICT (alias) DO NOTHING
      RETURNING alias`;
    if (rows.length) insertedNames++;
  }
  console.log(`dish_name_aliases: ${insertedNames} new / ${DISH_NAME_ALIASES.length} total`);
}

main();
