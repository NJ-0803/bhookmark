// A real, runnable smoke test against the live dev API — not a description
// of what a red team would do, an actual pass/fail run of a P0 subset from
// Section 17's matrix. Run with: node scripts/redteam-smoke.mjs
// Requires the server running on :4001 (npm run dev).

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
  const res = await fetch(BASE + path, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts.headers ?? {}) },
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* no body */
  }
  return { status: res.status, body };
}

async function loginFreshUser(phoneSuffix) {
  const phone = `+9198765${phoneSuffix}`;
  const req = await j("/auth/otp/request", { method: "POST", body: JSON.stringify({ phone }) });
  const otp = req.body.devOtp;
  const verify = await j("/auth/otp/verify", {
    method: "POST",
    body: JSON.stringify({ phone, otp, deviceLabel: "smoke-test" }),
  });
  return { phone, ...verify.body };
}

async function main() {
  console.log("\nRT-13 / A-01: OTP request rate limit (>3 requests/10min for one phone)");
  {
    const phone = "+919900011122";
    let lastStatus = 200;
    for (let i = 0; i < 5; i++) {
      const r = await j("/auth/otp/request", { method: "POST", body: JSON.stringify({ phone }) });
      lastStatus = r.status;
    }
    check("6th request in-window is rate-limited (429)", lastStatus === 429, `got ${lastStatus}`);
  }

  console.log("\nA-02: OTP verify gives a generic, timing-flat error regardless of whether the phone is registered");
  {
    const known = await j("/auth/otp/verify", {
      method: "POST",
      body: JSON.stringify({ phone: "+919900011122", otp: "000000", deviceLabel: "x" }),
    });
    const unknown = await j("/auth/otp/verify", {
      method: "POST",
      body: JSON.stringify({ phone: "+919900099999", otp: "000000", deviceLabel: "x" }),
    });
    check(
      "identical error body for known vs unknown phone",
      JSON.stringify(known.body) === JSON.stringify(unknown.body),
      `${JSON.stringify(known.body)} vs ${JSON.stringify(unknown.body)}`
    );
  }

  console.log("\nA-03: OTP brute force capped at 5 attempts");
  {
    const phone = "+919900022233";
    await j("/auth/otp/request", { method: "POST", body: JSON.stringify({ phone }) });
    let lastStatus = 0;
    for (let i = 0; i < 6; i++) {
      const r = await j("/auth/otp/verify", {
        method: "POST",
        body: JSON.stringify({ phone, otp: "999999", deviceLabel: "x" }),
      });
      lastStatus = r.status;
    }
    check("6th wrong attempt is rejected as too-many-attempts (429)", lastStatus === 429, `got ${lastStatus}`);
  }

  console.log("\nA-04: refresh-token reuse revokes the whole session family");
  {
    const alice = await loginFreshUser("111222");
    const r1 = await j("/auth/refresh", { method: "POST", body: JSON.stringify({ refreshToken: alice.refreshToken }) });
    const replay = await j("/auth/refresh", { method: "POST", body: JSON.stringify({ refreshToken: alice.refreshToken }) });
    const afterRevoke = await j("/auth/refresh", { method: "POST", body: JSON.stringify({ refreshToken: r1.body.refreshToken }) });
    check("first refresh succeeds", r1.status === 200, `got ${r1.status}`);
    check("replaying the old (already-rotated) token is rejected", replay.status === 401, `got ${replay.status}`);
    check("the rotated family is fully revoked, even the valid-looking new token", afterRevoke.status === 401, `got ${afterRevoke.status}`);
  }

  console.log("\nA-08/A-09: IDOR — cannot read or delete another user's log");
  {
    const alice = await loginFreshUser("333444");
    const bob = await loginFreshUser("555666");
    const created = await j("/logs", {
      method: "POST",
      headers: { Authorization: `Bearer ${alice.accessToken}` },
      body: JSON.stringify({
        category: "Burger", subtype: "Chicken", name: "Test Burger", venue: "Test Venue",
        verdict: "loved", score: 8.5, deviceId: "dev-alice",
        evidence: { livePhoto: true, liveLocationMatch: true, receipt: false },
      }),
    });
    const logId = created.body.log.id;
    const bobRead = await j(`/logs/${logId}`, { headers: { Authorization: `Bearer ${bob.accessToken}` } });
    const bobDelete = await j(`/logs/${logId}`, { method: "DELETE", headers: { Authorization: `Bearer ${bob.accessToken}` } });
    const aliceRead = await j(`/logs/${logId}`, { headers: { Authorization: `Bearer ${alice.accessToken}` } });
    check("owner can read their own log", aliceRead.status === 200, `got ${aliceRead.status}`);
    check("a different user cannot read it (404, not 403 — no existence leak)", bobRead.status === 404, `got ${bobRead.status}`);
    check("a different user cannot delete it", bobDelete.status === 404, `got ${bobDelete.status}`);
  }

  console.log("\nA-07: a plain user cannot call the moderator queue");
  {
    const alice = await loginFreshUser("777888");
    const r = await j("/moderation/queue", { headers: { Authorization: `Bearer ${alice.accessToken}` } });
    check("moderation queue denied for role=user (403)", r.status === 403, `got ${r.status}`);
  }

  console.log("\nF-10/F-11: idempotency key prevents a double-submit from creating two logs");
  {
    const alice = await loginFreshUser("999000");
    const idKey = "smoke-test-key-1";
    const payload = JSON.stringify({
      category: "Dosa & Idli", subtype: "Benne Dosa", name: "Benne Masala Dosa", venue: "CTR",
      verdict: "loved", score: 9.0, deviceId: "dev-alice",
      evidence: { livePhoto: true, liveLocationMatch: true, receipt: false },
    });
    const first = await j("/logs", {
      method: "POST",
      headers: { Authorization: `Bearer ${alice.accessToken}`, "Idempotency-Key": idKey },
      body: payload,
    });
    const retry = await j("/logs", {
      method: "POST",
      headers: { Authorization: `Bearer ${alice.accessToken}`, "Idempotency-Key": idKey },
      body: payload,
    });
    const mine = await j("/logs/mine", { headers: { Authorization: `Bearer ${alice.accessToken}` } });
    check("retry returns the exact same log id", first.body.log.id === retry.body.log.id, `${first.body.log.id} vs ${retry.body.log.id}`);
    check("only one log was actually created", mine.body.logs.length === 1, `found ${mine.body.logs.length}`);
  }

  console.log("\nT-01/T-04: velocity burst on one venue from one device gets held, not published");
  {
    const alice = await loginFreshUser("121314");
    let lastStatus = "published";
    for (let i = 0; i < 6; i++) {
      const r = await j("/logs", {
        method: "POST",
        headers: { Authorization: `Bearer ${alice.accessToken}` },
        body: JSON.stringify({
          category: "Burger", subtype: "Veg", name: "Farmer's Veg Burger", venue: "Burst Venue",
          verdict: "loved", score: 9.9, deviceId: "dev-burst",
          evidence: { livePhoto: false, liveLocationMatch: false, receipt: false },
        }),
      });
      lastStatus = r.body.log.status;
    }
    check("6th rapid log to the same venue/device is held for review", lastStatus === "held", `got ${lastStatus}`);
  }

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
