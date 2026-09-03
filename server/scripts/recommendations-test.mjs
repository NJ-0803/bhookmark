// Real test of the recommendation engine — not a description of the logic,
// an actual run against the live API. Seeds a user with a distinctive taste
// pattern (loves Dosa & Idli, dislikes Biryani, is vegetarian) and checks
// the three recommenders behave correctly against real computed data.
//
// Usage: node scripts/recommendations-test.mjs  (server must be running)

const BASE = "http://localhost:4001";
let pass = 0;
let fail = 0;

function check(name, condition, detail = "") {
  if (condition) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}  ${detail}`);
  }
}

async function j(path, opts = {}) {
  const res = await fetch(BASE + path, { ...opts, headers: { "Content-Type": "application/json", ...(opts.headers ?? {}) } });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function main() {
  const phone = "+919911223344";
  const otp = (await j("/auth/otp/request", { method: "POST", body: JSON.stringify({ phone }) })).body.devOtp;
  const auth = (await j("/auth/otp/verify", { method: "POST", body: JSON.stringify({ phone, otp, deviceLabel: "rec-test" }) })).body;
  const H = { Authorization: `Bearer ${auth.accessToken}` };

  console.log("\nSetting dietary profile to vegetarian, no allergens");
  const dietRes = await j("/profile/diet", { method: "PATCH", headers: H, body: JSON.stringify({ dietaryProfile: "vegetarian", allergens: [] }) });
  check("diet profile saved", dietRes.body.dietaryProfile === "vegetarian", JSON.stringify(dietRes.body));

  console.log("\nLogging a strong pattern: loves Dosa & Idli (x3), dislikes Biryani (x2)");
  const lovedDosas = [
    { category: "Dosa & Idli", subtype: "Benne Dosa", name: "Benne Masala Dosa", venue: "CTR", verdict: "loved", score: 9.2 },
    { category: "Dosa & Idli", subtype: "Benne Dosa", name: "Benne Masala Dosa", venue: "CTR", verdict: "loved", score: 9.0 },
    { category: "Dosa & Idli", subtype: "Plain / Set Dosa", name: "Set Dosa", venue: "Vidyarthi Bhavan", verdict: "loved", score: 8.7 },
  ];
  const dislikedBiryani = [
    { category: "Biryani", subtype: "Chicken", name: "Chicken Dum Biryani", venue: "Meghana Foods", verdict: "not-for-me", score: 4.5 },
    { category: "Biryani", subtype: "Chicken", name: "Chicken Dum Biryani", venue: "Meghana Foods", verdict: "not-for-me", score: 5.0 },
  ];
  for (const [i, entry] of [...lovedDosas, ...dislikedBiryani].entries()) {
    await j("/logs", {
      method: "POST",
      headers: { ...H, "Idempotency-Key": `rec-seed-${i}` },
      body: JSON.stringify({ ...entry, deviceId: "rec-test-device", evidence: { livePhoto: true, liveLocationMatch: true, receipt: false } }),
    });
  }

  console.log("\nAI recommender #1 — favorites (what they eat most and love most)");
  const favRes = await j("/recommendations/favorites", { headers: H });
  const topFav = favRes.body.favorites[0];
  check("top favorite is Dosa & Idli", topFav?.category === "Dosa & Idli", JSON.stringify(topFav));
  check("top favorite reflects 2 loved logs of the same subtype", topFav?.lovedCount === 2, JSON.stringify(topFav));

  console.log("\nAI recommender #2 — avoid (what they consistently dislike)");
  const avoidRes = await j("/recommendations/avoid", { headers: H });
  const topAvoid = avoidRes.body.avoid[0];
  check("top avoid pattern is Biryani/Chicken", topAvoid?.category === "Biryani" && topAvoid?.subtype === "Chicken", JSON.stringify(topAvoid));

  console.log("\nAI recommender #3 — next pick (grounded, diet-aware, avoids disliked pattern)");
  const nextRes = await j("/recommendations/next", { headers: H });
  const picks = nextRes.body.picks;
  check("returns at least one pick", picks.length > 0, JSON.stringify(nextRes.body));
  check("no pick is the disliked Biryani/Chicken subtype", !picks.some((p) => p.category === "Biryani" && p.subtype === "Chicken"), JSON.stringify(picks));
  const nonVegNames = ["Mutton Biryani", "Peri Peri Chicken Burger", "Chicken Dum Biryani"];
  check(
    "no non-veg dish is picked despite the vegetarian profile",
    !picks.some((p) => nonVegNames.includes(p.name)),
    JSON.stringify(picks.map((p) => p.name))
  );
  check("reports whether the high-level model wrote the blurb or the template did", ["llm", "template"].includes(picks[0]?.reasonSource), JSON.stringify(picks[0]));
  console.log(`    llmConfigured: ${nextRes.body.llmConfigured}  →  first pick reasonSource: ${picks[0]?.reasonSource}`);
  console.log(`    "${picks[0]?.reason}"`);

  console.log("\nEngagement digest — a real reason to reopen the app, computed from real logs");
  const digestRes = await j("/recommendations/digest", { headers: H });
  const digest = digestRes.body.digest;
  check("digest reports logs made this week", digest.logsThisWeek === 5, JSON.stringify(digest));
  check("digest's top category this week is Dosa & Idli", digest.topCategoryThisWeek === "Dosa & Idli", JSON.stringify(digest));
  check("digest includes a next pick", digest.nextPicks.length > 0, JSON.stringify(digest.nextPicks));

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
