// Real test of the near-me feature against the live API.
// Run after seed-venues-demo.mjs has populated real reviews.
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

async function main() {
  console.log("\nBurgers near Koramangala (radius 10km)");
  const near = await j("/venues/nearby?category=Burger&lat=12.9350&lng=77.6250&radiusKm=10");
  check("request succeeds", near.body.ok === true);
  check("results sorted by distance ascending", near.body.results.every((r, i, arr) => i === 0 || arr[i - 1].distanceKm <= r.distanceKm), JSON.stringify(near.body.results.map(r => r.distanceKm)));
  check("nearest result is the venue 0.2km away (Truffles)", near.body.results[0]?.name === "Truffles", JSON.stringify(near.body.results[0]));
  check("ratings reflect real seeded reviews, not just static baseline", near.body.results.every(r => r.ratingSource === "community"), JSON.stringify(near.body.results.map(r => r.ratingSource)));

  console.log("\nTight radius excludes farther venues");
  const tight = await j("/venues/nearby?category=Burger&lat=12.9350&lng=77.6250&radiusKm=1");
  check("only the very close venue is returned", tight.body.results.length === 1 && tight.body.results[0].name === "Truffles", JSON.stringify(tight.body.results));

  console.log("\nA category with no nearby venues returns an empty, not an error");
  const none = await j("/venues/nearby?category=Filter+Coffee&lat=12.9350&lng=77.6250&radiusKm=0.5");
  check("empty result set, still ok:true", none.body.ok === true && none.body.results.length === 0, JSON.stringify(none.body));

  console.log("\nMissing params are rejected cleanly");
  const bad = await j("/venues/nearby?category=Burger");
  check("400 with a clear error, not a crash", bad.status === 400, `got ${bad.status}`);

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail > 0 ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
