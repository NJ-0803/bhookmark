// Real, runnable tests for specific line items from the "Required QA suite"
// section of the implementation brief (P0 functional / P0 authorization /
// P0 trust / reliability / performance) that weren't already covered by
// redteam-smoke.mjs, recommendations-test.mjs, nearby-test.mjs, or
// notifications-test.mjs. Run with: node scripts/qa-brief-tests.mjs
// Requires the server running on :4001 (npm run dev) against a real DB.
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
  const headers = { "Content-Type": "application/json", ...(opts.headers ?? {}) };
  const res = await fetch(`${BASE}${path}`, { ...opts, headers });
  let body;
  try { body = await res.json(); } catch { body = null; }
  return { status: res.status, body };
}

async function signUp(phone) {
  const req = await j("/auth/otp/request", { method: "POST", body: JSON.stringify({ phone }) });
  const verify = await j("/auth/otp/verify", { method: "POST", body: JSON.stringify({ phone, otp: req.body.devOtp, deviceLabel: "qa-test" }) });
  return verify.body;
}

async function createLog(user, dish, evidence = { livePhoto: false, receipt: false, location: null }) {
  return j("/logs", {
    method: "POST",
    headers: { Authorization: `Bearer ${user.accessToken}`, "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify({ ...dish, verdict: "loved", score: 8.0, note: "private note text should never leak publicly", deviceId: user.deviceId, evidence }),
  });
}

async function main() {
  // ---- P0 functional / trust: private (held/removed) logs never leak into public aggregates ----
  console.log("\nP0 functional/trust — held logs never contribute to a public score");
  {
    const phone = `+91900001${Math.floor(Math.random() * 9000 + 1000)}`;
    const user = await signUp(phone);
    // A subtype unique to this run — the category+subtype endpoint aggregates
    // city-wide by design (all venues sharing that subtype), so reusing a
    // real subtype like "Veg" would pick up unrelated logs from other test
    // runs and make this isolation check meaningless.
    const dish = { category: "Burger", subtype: `QA-Isolated-${crypto.randomUUID().slice(0, 8)}`, name: "QA Held Burger", venue: "QA Burst Diner" };

    // Drive past the burst threshold (>5 logs, same device+venue, within 10min)
    // so the later ones land as status: "held", not "published".
    let heldSeen = false;
    for (let i = 0; i < 7; i++) {
      const r = await createLog(user, dish);
      if (r.body?.log?.status === "held") heldSeen = true;
    }
    check("at least one log was actually held (burst triggered as expected)", heldSeen);

    const score = await j(`/dishes/score?venue=${encodeURIComponent(dish.venue)}&category=${dish.category}&subtype=${dish.subtype}&name=${encodeURIComponent(dish.name)}`);
    check("public score count is capped at the burst threshold (5), not 7", score.body.community.count <= 5, JSON.stringify(score.body.community));

    const catScore = await j(`/dishes/${dish.category}/${dish.subtype}`);
    check("category-wide aggregate also excludes held logs", catScore.body.count <= 5, JSON.stringify(catScore.body));
  }

  // ---- P0 authorization: public API never exposes another user's private note or exact location ----
  console.log("\nP0 authorization — /dishes/score never leaks a private note or raw coordinates");
  {
    const phoneA = `+91900002${Math.floor(Math.random() * 9000 + 1000)}`;
    const userA = await signUp(phoneA);
    const dish = { category: "Pizza", subtype: "Veg", name: "QA Privacy Pizza", venue: "QA Privacy Cafe" };
    await createLog(userA, dish, { livePhoto: false, receipt: false, location: { lat: 12.9, lng: 77.6 } });

    const score = await j(`/dishes/score?venue=${encodeURIComponent(dish.venue)}&category=${dish.category}&subtype=${dish.subtype}&name=${encodeURIComponent(dish.name)}`);
    const raw = JSON.stringify(score.body);
    check("response never contains the raw note text", !raw.includes("private note text"), raw);
    check("response never contains raw lat/lng coordinates", !raw.includes("12.9") && !raw.includes("77.6"), raw);
    check("response has no 'note' field at all", !("note" in (score.body.community ?? {})) && !("note" in (score.body.yours ?? {})), raw);
  }

  // ---- P0 trust: a legitimate multi-user spike is not wrongly classified as abuse ----
  console.log("\nP0 trust — a real spike from many DIFFERENT users/devices is not wrongly held (only same-device bursts are)");
  {
    const dish = { category: "Biryani", subtype: "Chicken", name: "QA Viral Biryani", venue: "QA Viral Spot" };
    const results = [];
    for (let i = 0; i < 8; i++) {
      const phone = `+91900003${1000 + i}`;
      const user = await signUp(phone);
      const r = await createLog(user, dish);
      results.push(r.body?.log?.status);
    }
    const heldCount = results.filter((s) => s === "held").length;
    check(
      "none of the 8 different-user/different-device logs were held (volume alone isn't abuse)",
      heldCount === 0,
      `statuses: ${JSON.stringify(results)}`
    );
  }

  // ---- P0 authorization: a revoked session can no longer refresh ----
  console.log("\nP0 authorization — a revoked session's refresh token is rejected");
  {
    const phone = `+91900004${Math.floor(Math.random() * 9000 + 1000)}`;
    const user = await signUp(phone);

    const revoke = await j(`/auth/sessions/${user.deviceId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${user.accessToken}` },
    });
    check("session revocation succeeds", revoke.status === 200 && revoke.body.ok, JSON.stringify(revoke.body));

    const refreshAttempt = await j("/auth/refresh", { method: "POST", body: JSON.stringify({ refreshToken: user.refreshToken }) });
    check("refreshing a revoked session's token is rejected (401)", refreshAttempt.status === 401, JSON.stringify(refreshAttempt.body));

    // Documented, expected tradeoff: the short-lived (15min) access token
    // issued before revocation is a stateless JWT and remains valid until
    // its own natural expiry — revocation blocks long-term access via
    // refresh, not the current in-flight access token. Confirm that's
    // still true (not accidentally invalidated in a way that breaks UX,
    // and not silently un-revoked either) by checking it still verifies.
    const stillWorks = await j("/logs/mine", { headers: { Authorization: `Bearer ${user.accessToken}` } });
    check(
      "the already-issued access token still works until its own 15min expiry (expected JWT tradeoff, not a bug)",
      stillWorks.status === 200,
      JSON.stringify(stillWorks.body)
    );
  }

  // ---- Performance: hot-key test — many concurrent requests targeting the SAME dish ----
  console.log("\nPerformance — hot-key: 50 concurrent reads of the SAME dish score, not spread across many");
  {
    const dish = { category: "Filter Coffee", subtype: "Strong / Degree", name: "Degree Coffee", venue: "Vidyarthi Bhavan" };
    const url = `/dishes/score?venue=${encodeURIComponent(dish.venue)}&category=${encodeURIComponent(dish.category)}&subtype=${encodeURIComponent(dish.subtype)}&name=${encodeURIComponent(dish.name)}`;
    const start = Date.now();
    const results = await Promise.all(Array.from({ length: 50 }, () => j(url)));
    const elapsed = Date.now() - start;
    const allOk = results.every((r) => r.status === 200 && r.body.ok);
    check("all 50 concurrent hot-key reads of the same dish succeed", allOk, JSON.stringify(results.filter((r) => r.status !== 200)));
    console.log(`    50 concurrent same-dish reads completed in ${elapsed}ms`);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
