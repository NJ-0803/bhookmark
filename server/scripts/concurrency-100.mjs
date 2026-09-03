// A real concurrency test: 100 simulated users hitting the live dev API at
// the same time, each running a realistic multi-step journey (sign in, log
// a couple of dishes, read a dish's aggregate, list their own journal).
// This is actually run — the numbers below are measured, not estimated.
//
// Usage: node scripts/concurrency-100.mjs
// Requires the server running on :4001 (npm run dev).

const BASE = "http://localhost:4001";
const USER_COUNT = 100;

const CATEGORIES = [
  { category: "Dosa & Idli", subtype: "Benne Dosa", name: "Benne Masala Dosa", venue: "CTR" },
  { category: "Biryani", subtype: "Chicken", name: "Chicken Dum Biryani", venue: "Meghana Foods" },
  { category: "Filter Coffee", subtype: "Strong / Degree", name: "Degree Coffee", venue: "Vidyarthi Bhavan" },
];

const latencies = { otpRequest: [], otpVerify: [], createLog: [], readDish: [], listMine: [] };
const errors = [];

function record(bucket, ms) {
  latencies[bucket].push(ms);
}

async function timed(bucket, fn) {
  const start = performance.now();
  const result = await fn();
  record(bucket, performance.now() - start);
  return result;
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

async function runUser(index) {
  const phone = `+9199${String(1000000 + index).padStart(7, "0")}`;

  const otpReq = await timed("otpRequest", () => j("/auth/otp/request", { method: "POST", body: JSON.stringify({ phone }) }));
  if (!otpReq.body?.ok) {
    errors.push({ user: index, step: "otp-request", status: otpReq.status, body: otpReq.body });
    return;
  }

  const verify = await timed("otpVerify", () =>
    j("/auth/otp/verify", { method: "POST", body: JSON.stringify({ phone, otp: otpReq.body.devOtp, deviceLabel: `load-test-${index}` }) })
  );
  if (!verify.body?.ok) {
    errors.push({ user: index, step: "otp-verify", status: verify.status, body: verify.body });
    return;
  }
  const accessToken = verify.body.accessToken;
  const deviceId = verify.body.deviceId;

  // Each simulated user logs 2 dishes and reads their own journal + one
  // public dish aggregate — a realistic small session, not a single hammer-one-endpoint blast.
  for (let i = 0; i < 2; i++) {
    const dish = CATEGORIES[(index + i) % CATEGORIES.length];
    const createRes = await timed("createLog", () =>
      j("/logs", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Idempotency-Key": `load-${index}-${i}` },
        body: JSON.stringify({
          ...dish,
          verdict: "loved",
          score: 8 + Math.random(),
          deviceId,
          evidence: { livePhoto: true, liveLocationMatch: true, receipt: false },
        }),
      })
    );
    if (!createRes.body?.ok) errors.push({ user: index, step: `create-log-${i}`, status: createRes.status, body: createRes.body });
  }

  const dishRead = await timed("readDish", () => j(`/dishes/${encodeURIComponent(CATEGORIES[0].category)}/${encodeURIComponent(CATEGORIES[0].subtype)}`));
  if (!dishRead.body?.ok) errors.push({ user: index, step: "read-dish", status: dishRead.status, body: dishRead.body });

  const mine = await timed("listMine", () => j("/logs/mine", { headers: { Authorization: `Bearer ${accessToken}` } }));
  if (!mine.body?.ok) errors.push({ user: index, step: "list-mine", status: mine.status, body: mine.body });
}

function percentile(arr, p) {
  if (arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

async function main() {
  console.log(`\nFiring ${USER_COUNT} concurrent user sessions at ${BASE} ...\n`);
  const wallStart = performance.now();

  await Promise.all(Array.from({ length: USER_COUNT }, (_, i) => runUser(i)));

  const wallMs = performance.now() - wallStart;
  const totalRequests = Object.values(latencies).reduce((s, arr) => s + arr.length, 0);

  console.log(`Wall time for all ${USER_COUNT} sessions to complete: ${wallMs.toFixed(0)}ms`);
  console.log(`Total requests made: ${totalRequests}`);
  console.log(`Throughput: ${(totalRequests / (wallMs / 1000)).toFixed(1)} req/s\n`);

  console.log("Per-endpoint latency (ms), from real measured requests:");
  for (const [bucket, arr] of Object.entries(latencies)) {
    if (arr.length === 0) {
      console.log(`  ${bucket.padEnd(12)} — no successful samples`);
      continue;
    }
    console.log(
      `  ${bucket.padEnd(12)} n=${String(arr.length).padEnd(4)} p50=${percentile(arr, 50).toFixed(1).padStart(6)}  p95=${percentile(arr, 95).toFixed(1).padStart(6)}  p99=${percentile(arr, 99).toFixed(1).padStart(6)}  max=${Math.max(...arr).toFixed(1).padStart(6)}`
    );
  }

  console.log(`\nErrors: ${errors.length} / ${USER_COUNT} user-steps failed`);
  if (errors.length) {
    const byStatus = {};
    for (const e of errors) byStatus[e.status] = (byStatus[e.status] ?? 0) + 1;
    console.log("  by status code:", byStatus);
    console.log("  first 5 errors:", JSON.stringify(errors.slice(0, 5), null, 2));
  }

  console.log("");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
