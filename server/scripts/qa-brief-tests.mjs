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

// `ip` sets X-Forwarded-For, which the real app now honors (app.set("trust
// proxy", true) — see the fix that made this test correct in the first
// place) so plain fetch from one machine can still simulate real network
// diversity without needing supertest.
async function signUp(phone, ip) {
  const headers = ip ? { "X-Forwarded-For": ip } : {};
  const req = await j("/auth/otp/request", { method: "POST", headers, body: JSON.stringify({ phone }) });
  const verify = await j("/auth/otp/verify", { method: "POST", headers, body: JSON.stringify({ phone, otp: req.body.devOtp, deviceLabel: "qa-test" }) });
  return verify.body;
}

async function createLog(user, dish, evidence = { livePhoto: false, receipt: false, location: null }, ip) {
  return j("/logs", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${user.accessToken}`,
      "Idempotency-Key": crypto.randomUUID(),
      ...(ip ? { "X-Forwarded-For": ip } : {}),
    },
    body: JSON.stringify({ ...dish, verdict: "loved", score: 8.0, note: "private note text should never leak publicly", deviceId: user.deviceId, evidence }),
  });
}

async function main() {
  // ---- P0 functional / trust: private (held/removed) logs never leak into public aggregates ----
  console.log("\nP0 functional/trust — held logs never contribute to a public score");
  {
    const ip = "198.51.100.1"; // dedicated fake network — isolates this test from this
    // machine's own real IP, which accumulates distinct QA accounts across every
    // run and would otherwise trip the multi-account-network signal by accident.
    const phone = `+91900001${Math.floor(Math.random() * 9000 + 1000)}`;
    const user = await signUp(phone, ip);
    // A subtype unique to this run — the category+subtype endpoint aggregates
    // city-wide by design (all venues sharing that subtype), so reusing a
    // real subtype like "Veg" would pick up unrelated logs from other test
    // runs and make this isolation check meaningless.
    const dish = { category: "Burger", subtype: `QA-Isolated-${crypto.randomUUID().slice(0, 8)}`, name: "QA Held Burger", venue: "QA Burst Diner" };

    // Drive past the burst threshold (>5 logs, same device+venue, within 10min)
    // so the later ones land as status: "held", not "published".
    let heldSeen = false;
    for (let i = 0; i < 7; i++) {
      const r = await createLog(user, dish, undefined, ip);
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
    const ip = "198.51.100.2";
    const phoneA = `+91900002${Math.floor(Math.random() * 9000 + 1000)}`;
    const userA = await signUp(phoneA, ip);
    const dish = { category: "Pizza", subtype: "Veg", name: "QA Privacy Pizza", venue: "QA Privacy Cafe" };
    await createLog(userA, dish, { livePhoto: false, receipt: false, location: { lat: 12.9, lng: 77.6 } }, ip);

    const score = await j(`/dishes/score?venue=${encodeURIComponent(dish.venue)}&category=${dish.category}&subtype=${dish.subtype}&name=${encodeURIComponent(dish.name)}`);
    const raw = JSON.stringify(score.body);
    check("response never contains the raw note text", !raw.includes("private note text"), raw);
    check("response never contains raw lat/lng coordinates", !raw.includes("12.9") && !raw.includes("77.6"), raw);
    check("response has no 'note' field at all", !("note" in (score.body.community ?? {})) && !("note" in (score.body.yours ?? {})), raw);
  }

  // ---- P0 trust: a legitimate multi-user spike is not wrongly classified as abuse ----
  // Each simulated user gets a genuinely distinct fake network (X-Forwarded-For) —
  // without that, all 8 share this test script's one real IP, which is
  // exactly the multi-account-same-network signal added this session and
  // would (correctly) hold every one of them. That's a test-environment
  // artifact, not a bug — see the paired test right after this one.
  console.log("\nP0 trust — a real spike from many DIFFERENT users on DIFFERENT networks is not wrongly held (only same-device bursts, or same-network multi-accounts, are)");
  {
    const dish = { category: "Biryani", subtype: "Chicken", name: "QA Viral Biryani", venue: "QA Viral Spot" };
    const results = [];
    for (let i = 0; i < 8; i++) {
      const phone = `+91900003${1000 + i}`;
      const ip = `203.0.113.${10 + i}`; // TEST-NET-3 (RFC 5737) — distinct per simulated user
      const user = await signUp(phone, ip);
      const r = await createLog(user, dish, undefined, ip);
      results.push(r.body?.log?.status);
    }
    const heldCount = results.filter((s) => s === "held").length;
    check(
      "none of the 8 different-user/different-network logs were held (volume alone isn't abuse)",
      heldCount === 0,
      `statuses: ${JSON.stringify(results)}`
    );
  }

  // ---- P0 trust: the multi-account-same-network signal DOES fire when it should ----
  console.log("\nP0 trust — many new accounts from the SAME network in a short window ARE held (brief 1.5: multi-account/same-network)");
  {
    const sharedIp = "203.0.113.99";
    const dish = { category: "Burger", subtype: "Chicken", name: "QA Sockpuppet Burger", venue: "QA Sockpuppet Diner" };
    const results = [];
    for (let i = 0; i < 5; i++) {
      const phone = `+91900005${1000 + i}`;
      const user = await signUp(phone, sharedIp);
      const r = await createLog(user, dish, undefined, sharedIp);
      results.push(r.body?.log?.status);
    }
    const laterHeld = results.slice(3).every((s) => s === "held");
    check(
      "once the same-network threshold is crossed, later signups from it are held for review",
      laterHeld,
      `statuses: ${JSON.stringify(results)}`
    );

    const events = await j("/dev/security-events");
    const flagged = events.body.events?.some((e) => e.type === "log_held_for_review" && e.detail.includes("multi_account_network"));
    check("a real, inspectable security event was recorded for the flagged logs", flagged === true);
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

  // ---- P0 trust: repeated delete-and-repost at the same venue is held ----
  console.log("\nP0 trust — a single delete-and-repost is fine, but the 3rd cycle at the same venue in a day is held");
  {
    const ip = "198.51.100.3";
    const phone = `+91900006${Math.floor(Math.random() * 9000 + 1000)}`;
    const user = await signUp(phone, ip);
    const dish = { category: "Momos", subtype: "Veg", name: "QA Repost Momo", venue: "QA Repost Kitchen" };

    async function postThenDelete() {
      const r = await createLog(user, dish, undefined, ip);
      await j(`/logs/${r.body.log.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${user.accessToken}` } });
      return r.body.log.status;
    }

    const first = await postThenDelete(); // 1st post — no prior deletions yet
    const second = await postThenDelete(); // 2nd post — 1 prior deletion, still under threshold
    const thirdLog = await createLog(user, dish, undefined, ip); // 3rd post — 2 prior deletions, threshold met

    check("1st post at this venue is published, not held", first === "published", first);
    check("2nd post (after one delete) is still published — one cycle is normal", second === "published", second);
    check("3rd post (after two deletes) is held for review", thirdLog.body?.log?.status === "held", JSON.stringify(thirdLog.body));
  }

  // ---- P0 trust: impossible travel between two location-verified logs is held ----
  console.log("\nP0 trust — two location-verified logs at real venues too far apart to reach in time are held");
  {
    const ip = "198.51.100.4";
    const phone = `+91900007${Math.floor(Math.random() * 9000 + 1000)}`;
    const user = await signUp(phone, ip);
    const CTR = { lat: 12.9941, lng: 77.5709 }; // Malleshwaram
    const TRUFFLES = { lat: 12.9345, lng: 77.6265 }; // Koramangala, ~9km from CTR

    const first = await createLog(
      user,
      { category: "Dosa & Idli", subtype: "Benne Dosa", name: "QA Travel Dosa", venue: "CTR (Shri Sagar)" },
      { livePhoto: false, receipt: false, location: CTR },
      ip
    );
    check("1st location-verified log at CTR is published", first.body?.log?.status === "published", JSON.stringify(first.body));
    check("1st log is genuinely location-verified", first.body?.log?.evidenceLevel !== "declared", first.body?.log?.evidenceLevel);

    const second = await createLog(
      user,
      { category: "Burger", subtype: "Chicken", name: "QA Travel Burger", venue: "Truffles" },
      { livePhoto: false, receipt: false, location: TRUFFLES },
      ip
    );
    check(
      "2nd log ~9km away, moments later, is held as impossible travel",
      second.body?.log?.status === "held",
      JSON.stringify(second.body)
    );

    const events = await j("/dev/security-events");
    const flagged = events.body.events?.some((e) => e.type === "log_held_for_review" && e.detail.includes("impossible_travel"));
    check("a real, inspectable security event was recorded for the impossible-travel hold", flagged === true);
  }

  // ---- Real trending signal (brief 1.6: never an urgency label without a real time window) ----
  console.log("\nBrief 1.6 — /dishes/trending only returns a result once real evidence clears the floor, and never surfaces QA fixtures");
  {
    const before = await j("/dishes/trending");
    check("responds ok:true", before.body.ok === true, JSON.stringify(before.body));
    check("windowDays is real and documented (7)", before.body.windowDays === 7, before.body.windowDays);
    if (before.body.trending) {
      const t = before.body.trending;
      check(
        "no QA/test fixture ever surfaces as trending, even if it technically clears the floor",
        !/qa |test/i.test(t.venue) && !/qa |test|ghost/i.test(t.name),
        JSON.stringify(t)
      );
      check("a real trending claim carries a real count >= 5 and >= 3 distinct users", t.count >= 5 && t.distinctUsers >= 3, JSON.stringify(t));
    } else {
      check("trending is honestly null rather than guessed, when nothing clears the evidence floor", before.body.trending === null);
    }
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
