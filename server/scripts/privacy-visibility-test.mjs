// Real tests for granular log visibility (brief Phase 2: "private diary").
// Public is the default (this app's core loop is a shared community
// score) — private is an explicit per-log opt-in that must never leak
// into any public aggregate, while still being visible to its own owner.
// Run with: node scripts/privacy-visibility-test.mjs (requires :4001)
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

function randomTestIp() {
  const o = () => Math.floor(Math.random() * 256);
  return `10.${o()}.${o()}.${o()}`;
}

async function signUp(phone, ip) {
  const headers = { "X-Forwarded-For": ip };
  const req = await j("/auth/otp/request", { method: "POST", headers, body: JSON.stringify({ phone }) });
  const verify = await j("/auth/otp/verify", { method: "POST", headers, body: JSON.stringify({ phone, otp: req.body.devOtp, deviceLabel: "privacy-test" }) });
  return verify.body;
}

async function createLog(user, dish, visibility, ip) {
  return j("/logs", {
    method: "POST",
    headers: { Authorization: `Bearer ${user.accessToken}`, "Idempotency-Key": crypto.randomUUID(), "X-Forwarded-For": ip },
    body: JSON.stringify({ ...dish, verdict: "loved", score: 9.0, note: "a private thought", deviceId: user.deviceId, visibility, evidence: { livePhoto: false, receipt: false, location: null } }),
  });
}

async function main() {
  const ip = randomTestIp();
  const dish = { category: "Filter Coffee", subtype: "Light", name: `QA Private Coffee ${crypto.randomUUID().slice(0, 6)}`, venue: "QA Private Cafe" };

  console.log("\nDefault visibility, when omitted, is public");
  {
    const phone = `+91900020${Math.floor(Math.random() * 9000 + 1000)}`;
    const user = await signUp(phone, ip);
    const r = await j("/logs", {
      method: "POST",
      headers: { Authorization: `Bearer ${user.accessToken}`, "Idempotency-Key": crypto.randomUUID(), "X-Forwarded-For": ip },
      body: JSON.stringify({ ...dish, name: `${dish.name}-default`, verdict: "loved", score: 8, note: "", deviceId: user.deviceId, evidence: { livePhoto: false, receipt: false, location: null } }),
    });
    check("visibility defaults to public when not specified", r.body?.log?.visibility === "public", JSON.stringify(r.body));
  }

  console.log("\nA private log is excluded from every public aggregate, but stays visible to its owner");
  {
    // A subtype unique to this block — the category+subtype endpoint
    // aggregates city-wide by design (see the "default visibility" block
    // above, which publishes its own real log under the same category),
    // so reusing "Light" here would count someone else's real data.
    const dish = { category: "Filter Coffee", subtype: `QA-Isolated-${crypto.randomUUID().slice(0, 8)}`, name: `QA Private Coffee ${crypto.randomUUID().slice(0, 6)}`, venue: "QA Private Cafe" };
    const phone = `+91900021${Math.floor(Math.random() * 9000 + 1000)}`;
    const user = await signUp(phone, ip);
    const privateLog = await createLog(user, dish, "private", ip);
    check("private log is created successfully", privateLog.status === 201, JSON.stringify(privateLog.body));
    check("stored visibility is 'private'", privateLog.body?.log?.visibility === "private", JSON.stringify(privateLog.body));
    check("still published (private isn't held for review)", privateLog.body?.log?.status === "published", privateLog.body?.log?.status);

    const score = await j(`/dishes/score?venue=${encodeURIComponent(dish.venue)}&category=${dish.category}&subtype=${dish.subtype}&name=${encodeURIComponent(dish.name)}`);
    check("the private log does NOT count toward the public community score", score.body.community.count === 0, JSON.stringify(score.body));

    const catScore = await j(`/dishes/${dish.category}/${dish.subtype}`);
    check("the private log does NOT count toward the category-wide aggregate", catScore.body.count === 0, JSON.stringify(catScore.body));

    const mine = await j("/logs/mine", { headers: { Authorization: `Bearer ${user.accessToken}` } });
    const ownEntry = mine.body.logs?.find((l) => l.name === dish.name);
    check("the owner still sees their own private log in their own journal", !!ownEntry, JSON.stringify(mine.body?.logs?.length));
    check("the private note text is intact for the owner", ownEntry?.note === "a private thought", ownEntry?.note);

    console.log("\nA second (different) user's PUBLIC log at the same dish DOES count, proving the exclusion is scoped correctly");
    const phone2 = `+91900022${Math.floor(Math.random() * 9000 + 1000)}`;
    const user2 = await signUp(phone2, ip);
    const publicLog = await createLog(user2, dish, "public", ip);
    check("a second, public log at the same dish is created", publicLog.status === 201, JSON.stringify(publicLog.body));

    const score2 = await j(`/dishes/score?venue=${encodeURIComponent(dish.venue)}&category=${dish.category}&subtype=${dish.subtype}&name=${encodeURIComponent(dish.name)}`);
    check("now the community count is 1 (the public log), not 2 — the private one still excluded", score2.body.community.count === 1, JSON.stringify(score2.body));
    check("the community average reflects only the public log's score (9.0)", Math.abs(score2.body.community.score - 9.0) < 0.01, score2.body.community.score);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
