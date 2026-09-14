// Real tests for multi-dish visits and the visit-aware burst check (POST /logs).
// Run with: node scripts/visits-test.mjs (requires the server on :4001,
// started against the test branch — see .env.test)
import { randomUUID } from "node:crypto";

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
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

function randomTestIp() {
  const o = () => Math.floor(Math.random() * 256);
  return `10.${o()}.${o()}.${o()}`;
}

async function signUp(phone, ip) {
  const headers = { "X-Forwarded-For": ip };
  const req = await j("/auth/otp/request", { method: "POST", headers, body: JSON.stringify({ phone }) });
  const verify = await j("/auth/otp/verify", { method: "POST", headers, body: JSON.stringify({ phone, otp: req.body.devOtp, deviceLabel: "visits-test" }) });
  return { ...verify.body, ip };
}

// Every request carries the user's own test IP: otherwise all logs arrive
// from 127.0.0.1 and trip the real multi-account-network hold, which would
// mask what this script is testing.
const auth = (user, key = randomUUID()) => ({ Authorization: `Bearer ${user.accessToken}`, "Idempotency-Key": key, "X-Forwarded-For": user.ip });

// Private logs, so test data never touches public aggregates.
function logBody(venue, overrides = {}) {
  return {
    category: "Burger",
    subtype: "Veg",
    name: `QA Visit Dish ${Math.floor(Math.random() * 1e6)}`,
    venue,
    verdict: "fine",
    score: 7,
    note: "",
    visibility: "private",
    evidence: { livePhoto: false, receipt: false, location: null },
    ...overrides,
  };
}

const post = (user, body, key) => j("/logs", { method: "POST", headers: auth(user, key), body: JSON.stringify(body) });

async function main() {
  const p = () => `+91900080${Math.floor(Math.random() * 9000 + 1000)}`;
  const run = Date.now();

  console.log("\nOne visit with several dishes publishes normally");
  const alice = await signUp(p(), randomTestIp());
  check("alice signed in", !!alice?.accessToken, JSON.stringify(alice));
  const venueA = `QA Visit Venue A ${run}`;
  const visit = randomUUID();
  const statuses = [];
  for (let i = 0; i < 8; i++) {
    const r = await post(alice, logBody(venueA, { visitId: visit }));
    statuses.push(r.body?.log?.status ?? `http ${r.status}`);
  }
  check("all 8 dishes in one visit are published, not held", statuses.every((s) => s === "published"), JSON.stringify(statuses));

  const mine = await j("/logs/mine", { headers: { Authorization: `Bearer ${alice.accessToken}` } });
  const inVisit = (mine.body?.logs ?? []).filter((l) => l.visitId === visit);
  check("the visit id is stored on every dish", inVisit.length === 8, `found ${inVisit.length}`);

  console.log("\nSeparate visits still trip the burst check");
  // Visit 1 was the 8-dish order above; visits 2–5 publish, the 6th visit
  // inside 10 minutes at the same venue on the same device is held.
  const separate = [];
  for (let i = 0; i < 5; i++) {
    const r = await post(alice, logBody(venueA));
    separate.push(r.body?.log?.status ?? `http ${r.status}`);
  }
  check("visits 2–5 at the same venue publish", separate.slice(0, 4).every((s) => s === "published"), JSON.stringify(separate));
  check("the 6th separate visit in 10 minutes is held for review", separate[4] === "held", JSON.stringify(separate));

  console.log("\nOne visit can't be used to post unlimited dishes");
  const bob = await signUp(p(), randomTestIp());
  const venueB = `QA Visit Venue B ${run}`;
  const bigVisit = randomUUID();
  const big = [];
  for (let i = 0; i < 13; i++) {
    const r = await post(bob, logBody(venueB, { visitId: bigVisit }));
    big.push(r.body?.log?.status ?? `http ${r.status}`);
  }
  check("dishes 1–12 of one visit publish", big.slice(0, 12).every((s) => s === "published"), JSON.stringify(big));
  check("the 13th dish of one visit is held for review", big[12] === "held", JSON.stringify(big));

  console.log("\nA visit id reused at another venue is a new visit there");
  const venueC = `QA Visit Venue C ${run}`;
  const reused = await post(bob, logBody(venueC, { visitId: bigVisit }));
  check("the same visit id at a different venue publishes", reused.body?.log?.status === "published", JSON.stringify(reused.body));

  console.log("\nValidation and retries");
  const carol = await signUp(p(), randomTestIp());
  const badId = await post(carol, logBody(`QA Visit Venue D ${run}`, { visitId: "not-a-uuid" }));
  check("a malformed visit id is rejected (400)", badId.status === 400, JSON.stringify(badId));
  const key = randomUUID();
  const retryVisit = randomUUID();
  const body = logBody(`QA Visit Venue D ${run}`, { visitId: retryVisit });
  const first = await post(carol, body, key);
  const second = await post(carol, body, key);
  check("a retried dish (same idempotency key) returns the same log", first.body?.log?.id && first.body.log.id === second.body?.log?.id, JSON.stringify([first.body?.log?.id, second.body?.log?.id]));
  const carolLogs = await j("/logs/mine", { headers: { Authorization: `Bearer ${carol.accessToken}` } });
  check("the retry created no duplicate", (carolLogs.body?.logs ?? []).filter((l) => l.visitId === retryVisit).length === 1, JSON.stringify(carolLogs.body?.logs?.length));
  const noVisit = await post(carol, logBody(`QA Visit Venue E ${run}`));
  check("a log without a visit id still posts (older clients)", noVisit.body?.log?.status === "published" && noVisit.body.log.visitId === null, JSON.stringify(noVisit.body?.log));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
