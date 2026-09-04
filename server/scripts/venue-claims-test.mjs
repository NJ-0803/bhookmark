// Real tests for the restaurant self-rating disclosure flow (brief 1.5):
// a venue claim grants nothing until a moderator approves it, and once
// approved, that owner's own logs at that venue stop counting toward the
// public score — while still showing up, labeled, in their own journal.
// Run with: node scripts/venue-claims-test.mjs (requires the server on :4001)
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

async function signUp(phone, ip) {
  const headers = ip ? { "X-Forwarded-For": ip } : {};
  const req = await j("/auth/otp/request", { method: "POST", headers, body: JSON.stringify({ phone }) });
  const verify = await j("/auth/otp/verify", { method: "POST", headers, body: JSON.stringify({ phone, otp: req.body.devOtp, deviceLabel: "venue-claim-test" }) });
  return verify.body;
}

async function createLog(user, dish, evidence = { livePhoto: false, receipt: false, location: null }, ip) {
  return j("/logs", {
    method: "POST",
    headers: { Authorization: `Bearer ${user.accessToken}`, "Idempotency-Key": crypto.randomUUID(), ...(ip ? { "X-Forwarded-For": ip } : {}) },
    body: JSON.stringify({ ...dish, verdict: "loved", score: 9.0, note: "", deviceId: user.deviceId, evidence }),
  });
}

// Promote to moderator + re-login, since role is baked into the JWT at
// issue time (see server/src/auth.ts) — matches the app's own documented
// tradeoff, not a workaround specific to this test.
async function becomeModerator(phone, ip) {
  const user = await signUp(phone, ip);
  const setRole = await j("/dev/set-role", { method: "POST", headers: { Authorization: `Bearer ${user.accessToken}` }, body: JSON.stringify({ role: "moderator" }) });
  if (!setRole.body?.ok) throw new Error("Could not promote to moderator: " + JSON.stringify(setRole.body));
  return signUp(phone, ip); // fresh token carrying the new role
}

// Random per-run fake IPs, not fixed constants — a hardcoded test IP reused
// across enough runs eventually crosses the real multi-account-network
// threshold and starts failing unrelated assertions (this bit qa-brief-tests.mjs
// once already; see its own randomTestIp for the full story).
function randomTestIp() {
  const b = () => 2 + Math.floor(Math.random() * 250);
  return `203.0.113.${b()}`;
}

async function main() {
  const ownerIp = randomTestIp();
  const modIp = randomTestIp();
  const outsiderIp = randomTestIp();
  const venue = `QA Claimed Diner ${crypto.randomUUID().slice(0, 6)}`;
  const dish = { category: "Burger", subtype: "Chicken", name: "QA Owner Burger", venue };

  console.log("\nSubmitting a claim requires auth and grants nothing by itself");
  {
    const noAuth = await j("/venues/claim", { method: "POST", body: JSON.stringify({ venue }) });
    check("401 without a token", noAuth.status === 401, JSON.stringify(noAuth.body));

    const ownerPhone = `+91900008${Math.floor(Math.random() * 9000 + 1000)}`;
    const owner = await signUp(ownerPhone, ownerIp);
    const claim = await j("/venues/claim", { method: "POST", headers: { Authorization: `Bearer ${owner.accessToken}` }, body: JSON.stringify({ venue }) });
    check("claim submission succeeds", claim.status === 201 && claim.body.ok, JSON.stringify(claim.body));

    const mine = await j("/venues/claims/mine", { headers: { Authorization: `Bearer ${owner.accessToken}` } });
    check("the claim shows up as 'pending' for its owner", mine.body.claims?.[0]?.status === "pending", JSON.stringify(mine.body));

    // Before approval: this "owner" is just a regular user as far as scoring goes.
    const preLog = await createLog(owner, dish, { livePhoto: false, receipt: false, location: null }, ownerIp);
    check("pre-approval log is published normally", preLog.body?.log?.status === "published", JSON.stringify(preLog.body));
    check("pre-approval log is NOT owner-disclosed", preLog.body?.log?.ownerDisclosed === false, JSON.stringify(preLog.body));

    const preScore = await j(`/dishes/score?venue=${encodeURIComponent(venue)}&category=${dish.category}&subtype=${dish.subtype}&name=${encodeURIComponent(dish.name)}`);
    check("pre-approval log DOES count toward the public score", preScore.body.community.count === 1, JSON.stringify(preScore.body));

    console.log("\nOnce a moderator approves the claim, the owner's NEW logs are disclosed and excluded from the public score");
    const modPhone = `+91900009${Math.floor(Math.random() * 9000 + 1000)}`;
    const moderator = await becomeModerator(modPhone, modIp);

    const claimsList = await j("/moderation/venue-claims?status=pending", { headers: { Authorization: `Bearer ${moderator.accessToken}` } });
    const target = claimsList.body.claims?.find((c) => c.venue === venue);
    check("the pending claim is visible in the moderation queue", !!target, JSON.stringify(claimsList.body));

    const approve = await j(`/moderation/venue-claims/${target.id}/approve`, { method: "POST", headers: { Authorization: `Bearer ${moderator.accessToken}` } });
    check("moderator can approve the claim", approve.status === 200 && approve.body.claim?.status === "approved", JSON.stringify(approve.body));

    const plainUser = await signUp(`+91900010${Math.floor(Math.random() * 9000 + 1000)}`, outsiderIp);
    const denied = await j(`/moderation/venue-claims/${target.id}/approve`, { method: "POST", headers: { Authorization: `Bearer ${plainUser.accessToken}` } });
    check("a plain user cannot approve claims (403)", denied.status === 403, JSON.stringify(denied.body));

    const postLog = await createLog(owner, { ...dish, name: "QA Owner Burger 2" }, { livePhoto: false, receipt: false, location: null }, ownerIp);
    check("post-approval log from the owner IS marked owner-disclosed", postLog.body?.log?.ownerDisclosed === true, JSON.stringify(postLog.body));
    check("post-approval log still posts (published), just disclosed", postLog.body?.log?.status === "published", JSON.stringify(postLog.body));

    const postScore = await j(`/dishes/score?venue=${encodeURIComponent(venue)}&category=${dish.category}&subtype=${dish.subtype}&name=${encodeURIComponent("QA Owner Burger 2")}`);
    check("the owner-disclosed log does NOT count toward the public score", postScore.body.community.count === 0, JSON.stringify(postScore.body));

    const ownJournal = await j("/logs/mine", { headers: { Authorization: `Bearer ${owner.accessToken}` } });
    const ownEntry = ownJournal.body.logs?.find((l) => l.name === "QA Owner Burger 2");
    check("the owner still sees their own disclosed log in their own journal", !!ownEntry, JSON.stringify(ownJournal.body?.logs?.length));

    console.log("\nA different, unrelated user's log at the SAME venue is unaffected");
    const outsider = await signUp(`+91900011${Math.floor(Math.random() * 9000 + 1000)}`, outsiderIp);
    const outsiderLog = await createLog(outsider, { ...dish, name: "QA Outsider Burger" }, { livePhoto: false, receipt: false, location: null }, outsiderIp);
    check("an unrelated user's log at the claimed venue is NOT owner-disclosed", outsiderLog.body?.log?.ownerDisclosed === false, JSON.stringify(outsiderLog.body));

    console.log("\nA rejected claim never grants disclosure status");
    const venue2 = `QA Rejected Diner ${crypto.randomUUID().slice(0, 6)}`;
    const rejectClaim = await j("/venues/claim", { method: "POST", headers: { Authorization: `Bearer ${owner.accessToken}` }, body: JSON.stringify({ venue: venue2 }) });
    const rejMine = await j("/venues/claims/mine", { headers: { Authorization: `Bearer ${owner.accessToken}` } });
    const rejTarget = rejMine.body.claims?.find((c) => c.venue === venue2);
    const reject = await j(`/moderation/venue-claims/${rejTarget.id}/reject`, { method: "POST", headers: { Authorization: `Bearer ${moderator.accessToken}` } });
    check("moderator can reject a claim", reject.body?.claim?.status === "rejected", JSON.stringify(reject.body));

    const rejLog = await createLog(owner, { category: "Pizza", subtype: "Veg", name: "QA Rejected Pizza", venue: venue2 }, { livePhoto: false, receipt: false, location: null }, ownerIp);
    check("a log at a REJECTED-claim venue is not owner-disclosed", rejLog.body?.log?.ownerDisclosed === false, JSON.stringify(rejLog.body));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
