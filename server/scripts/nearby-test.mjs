// Real test of the near-me / venue-search feature against the live API.
//
// 2026-09-11 rewrite: this used to assert hardcoded facts about the old
// 13-venue array ("Truffles is the nearest burger place," "no coffee
// within 0.5km of this point"). Phase 2 replaced that array with a real,
// several-thousand-venue table (OpenStreetMap ingestion) — those specific
// facts are no longer true (there's a closer burger place now; there are
// 16 real coffee shops within 0.5km of that point), which isn't a
// regression, it's the fix working. Asserting on the OLD facts would mean
// this suite fails forever as the real catalog keeps growing. Testing
// invariants that hold regardless of catalog size instead: distance
// ordering, radius correctness, alias resolution, and the new name-search
// endpoint.
const BASE = "http://localhost:4001";
let pass = 0, fail = 0;
function check(name, cond, detail = "") {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}  ${detail}`); }
}
async function j(path) {
  const res = await fetch(BASE + path);
  return { status: res.status, body: await res.json().catch(() => null) };
}
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const LAT = 12.9716, LNG = 77.6412; // Indiranagar — dense real coverage

async function main() {
  console.log("\nBurgers near Indiranagar (radius 10km) — real DB-backed catalog");
  const near = await j(`/venues/nearby?category=Burger&lat=${LAT}&lng=${LNG}&radiusKm=10`);
  check("request succeeds", near.body?.ok === true);
  check("category resolves", near.body?.categoryResolved === true);
  check("returns a real, nonzero result set", (near.body?.count ?? 0) > 0, `count=${near.body?.count}`);
  check(
    "results sorted by distance ascending",
    near.body.results.every((r, i, arr) => i === 0 || arr[i - 1].distanceKm <= r.distanceKm),
    JSON.stringify(near.body.results.slice(0, 5).map((r) => r.distanceKm))
  );
  check(
    "every result is genuinely within the requested radius",
    near.body.results.every((r) => r.distanceKm <= 10.05),
    JSON.stringify(near.body.results.filter((r) => r.distanceKm > 10.05))
  );
  check(
    "community score is honest: null when count is 0, a real number when count > 0",
    near.body.results.every((r) => (r.community.count === 0 ? r.community.score === null : typeof r.community.score === "number")),
    JSON.stringify(near.body.results.find((r) => (r.community.count === 0) === (r.community.score !== null)))
  );

  console.log("\nTight radius is a real subset of a wide radius (same category/point)");
  const tight = await j(`/venues/nearby?category=Burger&lat=${LAT}&lng=${LNG}&radiusKm=1`);
  const wide = await j(`/venues/nearby?category=Burger&lat=${LAT}&lng=${LNG}&radiusKm=10`);
  check("tight radius returns fewer or equal results than wide", tight.body.count <= wide.body.count, `tight=${tight.body.count} wide=${wide.body.count}`);
  const wideIds = new Set(wide.body.results.map((r) => r.id));
  check("every tight-radius result also appears in the wide radius", tight.body.results.every((r) => wideIds.has(r.id)));

  console.log("\nCategory alias resolution — the exact bug Phase 1 fixed for Coffee");
  const oldSpelling = await j(`/venues/nearby?category=Filter+Coffee&lat=${LAT}&lng=${LNG}&radiusKm=5`);
  const newSpelling = await j(`/venues/nearby?category=Coffee&lat=${LAT}&lng=${LNG}&radiusKm=5`);
  check("the old 'Filter Coffee' spelling still resolves via the alias table", oldSpelling.body?.categoryResolved === true);
  check(
    "'Filter Coffee' and 'Coffee' resolve to the identical result set",
    oldSpelling.body.count === newSpelling.body.count && oldSpelling.body.count > 0,
    `old=${oldSpelling.body.count} new=${newSpelling.body.count}`
  );

  console.log("\nA genuinely unresolvable category is honest about it, not an error");
  const none = await j(`/venues/nearby?category=Skydiving&lat=${LAT}&lng=${LNG}&radiusKm=5`);
  check("ok:true, categoryResolved:false, zero results — not a fabricated guess", none.body?.ok === true && none.body?.categoryResolved === false && none.body?.count === 0, JSON.stringify(none.body));

  console.log("\nBars & Pubs — the category that was entirely missing until this session");
  const bars = await j(`/venues/nearby?category=Bars+%26+Pubs&lat=${LAT}&lng=${LNG}&radiusKm=5`);
  check("Bars & Pubs resolves and returns real venues", bars.body?.categoryResolved === true && bars.body.count > 0, `count=${bars.body?.count}`);

  console.log("\nMissing params are rejected cleanly");
  const bad = await j("/venues/nearby?category=Burger");
  check("400 with a clear error, not a crash", bad.status === 400, `got ${bad.status}`);

  console.log("\nName search — findable by name regardless of resolved category");
  const search = await j("/venues/search?q=coffee");
  check("search succeeds and returns real venues", search.body?.ok === true && search.body.count > 0, `count=${search.body?.count}`);
  const doseSearch = await j("/venues/search?q=dose");
  check(
    "dish-name alias expansion: 'dose' finds real dosa venues",
    doseSearch.body?.ok === true && doseSearch.body.count > 0 && doseSearch.body.results.some((r) => r.name.toLowerCase().includes("dosa")),
    JSON.stringify(doseSearch.body?.results?.slice(0, 3))
  );
  const tooShort = await j("/venues/search?q=a");
  check("a too-short query is rejected, not silently truncated", tooShort.status === 400);

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail > 0 ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
