// Refresh the Patiala city catalog. No source guarantees every business.
// This imports every named food venue returned in the region, including
// venues without cuisine tags, and reports counts honestly. Dry-run by
// default; mirrors refresh-bangalore.mjs with the Patiala region and city.
import { neon } from "@neondatabase/serverless";
import { randomUUID } from "node:crypto";
import { isKnownProductionUrl } from "./prodHost.mjs";

const commit = process.argv.includes("--commit");
const databaseUrl = process.env.DATABASE_URL;
if (commit && !databaseUrl) throw new Error("DATABASE_URL is required for --commit.");
if (process.env.ALLOW_TEST_DB === "1") await import("./assertTestDatabase.mjs");
if (commit && isKnownProductionUrl(databaseUrl) && process.env.CONFIRM_PROD !== "1") throw new Error("Production refresh requires CONFIRM_PROD=1.");
const db = commit ? neon(databaseUrl) : null;
const bbox = "30.25,76.29,30.45,76.50";
const query = `[out:json][timeout:180];(
  nwr["amenity"~"^(restaurant|cafe|fast_food|pub|bar|biergarten|ice_cream|food_court)$"]["name"](${bbox});
  nwr["shop"~"^(bakery|confectionery|pastry)$"]["name"](${bbox});
);out center tags;`;
console.log(`Fetching named food venues in Patiala (${bbox}). ${commit ? "Will update catalog." : "Dry run; no database changes."}`);
const response = await fetch("https://overpass-api.de/api/interpreter", {
  method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "Bhookmark/2.0 (https://bhookmark.com; low-volume catalog refresh)" },
  body: new URLSearchParams({ data: query }), signal: AbortSignal.timeout(200_000),
});
if (!response.ok) throw new Error(`Overpass failed (${response.status}); catalog unchanged.`);
const data = await response.json();
if (data.remark) throw new Error(`Overpass returned an incomplete response: ${data.remark}. Refusing to import.`);
const now = Date.now();
const rows = (data.elements ?? []).flatMap((e) => {
  const name = e.tags?.name?.trim();
  const lat = e.lat ?? e.center?.lat;
  const lng = e.lon ?? e.center?.lon;
  if (!name || !Number.isFinite(lat) || !Number.isFinite(lng) || lat < 30.25 || lat > 30.45 || lng < 76.29 || lng > 76.50) return [];
  return [{ id: randomUUID(), osm_id: `${e.type}/${e.id}`, name, lat, lng,
    area: e.tags["addr:suburb"] || e.tags["addr:neighbourhood"] || e.tags["addr:street"] || "Patiala", now }];
});
let written = 0;
if (db) {
  // Batch reads/writes instead of one database round trip per venue.
  for (let i = 0; i < rows.length; i += 200) {
    const batch = JSON.stringify(rows.slice(i, i + 200));
    const result = await db`WITH incoming AS (
      SELECT * FROM jsonb_to_recordset(${batch}::jsonb) AS x(id text, osm_id text, name text, lat float8, lng float8, area text, now bigint)
    ), refreshed AS (
      UPDATE venues v SET name = x.name, area = x.area, lat = x.lat, lng = x.lng, updated_at = x.now
      FROM incoming x WHERE v.osm_id = x.osm_id AND v.status = 'active' RETURNING v.id
    ), inserted AS (
      INSERT INTO venues (id, osm_id, name, lat, lng, area, city, source, status, created_at, updated_at)
      SELECT id, osm_id, name, lat, lng, area, 'Patiala', 'osm', 'active', now, now
      FROM incoming x WHERE NOT EXISTS (SELECT 1 FROM venues v WHERE v.osm_id = x.osm_id)
      ON CONFLICT DO NOTHING RETURNING id
    ) SELECT (SELECT count(*)::int FROM refreshed) + (SELECT count(*)::int FROM inserted) AS n`;
    written += result[0].n;
  }
}
console.log(JSON.stringify({ returned: rows.length, written, skippedOrConflicted: commit ? rows.length - written : null, complete: false, region: bbox, fetchedAt: now }, null, 2));
// Never delete absent venues: one incomplete OSM mapping is not evidence
// that a business closed. Completeness/closure requires a separate audit.
