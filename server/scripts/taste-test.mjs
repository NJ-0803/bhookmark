// Real tests for the taste game (/taste/*): unlock threshold, questions only
// about the person's own places, answer validation, the Bradley–Terry
// ranking, and no-AI suggestions. Run with: node scripts/taste-test.mjs
// (server on :4001 against the test branch; no GROQ_API_KEY needed).
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

const randomTestIp = () => `10.${[0, 0, 0].map(() => Math.floor(Math.random() * 256)).join(".")}`;

async function signUp(phone) {
  const ip = randomTestIp();
  const headers = { "X-Forwarded-For": ip };
  const req = await j("/auth/otp/request", { method: "POST", headers, body: JSON.stringify({ phone }) });
  const verify = await j("/auth/otp/verify", { method: "POST", headers, body: JSON.stringify({ phone, otp: req.body.devOtp, deviceLabel: "taste-test" }) });
  return { ...verify.body, ip };
}

const h = (u) => ({ Authorization: `Bearer ${u.accessToken}`, "X-Forwarded-For": u.ip });
const get = (u, path) => j(path, { headers: h(u) });
const send = (u, path, body) => j(path, { method: "POST", headers: h(u), body: JSON.stringify(body) });
const log = (u, venue, score) =>
  j("/logs", {
    method: "POST",
    headers: { ...h(u), "Idempotency-Key": randomUUID() },
    body: JSON.stringify({ category: "Coffee", subtype: "Filter Coffee", name: "QA Taste Coffee", venue, verdict: score >= 8 ? "loved" : "fine", score, note: "", visibility: "private", evidence: { livePhoto: false, receipt: false, location: null } }),
  });

async function main() {
  const run = Date.now();
  const A = `QA Taste Cafe A ${run}`;
  const B = `QA Taste Cafe B ${run}`;
  const C = `QA Taste Cafe C ${run}`;
  const user = await signUp(`+91900110${Math.floor(Math.random() * 9000 + 1000)}`);
  check("test account signed in", !!user.accessToken, JSON.stringify(user));

  console.log("\nUnlocking");
  for (const [venue, score] of [[A, 9], [A, 8.5], [A, 8], [B, 7.5], [B, 7], [C, 6]]) await log(user, venue, score);
  let status = await get(user, "/taste/status");
  let coffee = status.body?.categories?.find((c) => c.category === "Coffee");
  check("6 Coffee logs: not unlocked yet", coffee?.logs === 6 && coffee?.eligible === false, JSON.stringify(coffee));
  const early = await get(user, "/taste/round?category=Coffee");
  check("a round before unlocking is refused (400)", early.status === 400, JSON.stringify(early.body));
  await log(user, C, 6.5);
  status = await get(user, "/taste/status");
  coffee = status.body?.categories?.find((c) => c.category === "Coffee");
  check("the 7th Coffee log unlocks it", coffee?.logs === 7 && coffee?.places === 3 && coffee?.eligible === true, JSON.stringify(coffee));
  check("status reports the real threshold (7)", status.body?.minLogs === 7, JSON.stringify(status.body?.minLogs));

  console.log("\nQuestions");
  const round = await get(user, "/taste/round?category=Coffee");
  const questions = round.body?.questions ?? [];
  const mine = new Set([A, B, C]);
  check("a round returns questions", round.status === 200 && questions.length >= 1, JSON.stringify(round.body));
  check("every option is a place this person logged", questions.every((q) => q.options.every((o) => mine.has(o))), JSON.stringify(questions));
  check("each question has 2 or 3 options", questions.every((q) => q.options.length >= 2 && q.options.length <= 3), JSON.stringify(questions.map((q) => q.options.length)));
  check("no question repeats in a round", new Set(questions.map((q) => [...q.options].sort().join("|"))).size === questions.length, JSON.stringify(questions));
  check("a 3-option question is offered when 3 places exist", questions.some((q) => q.options.length === 3), JSON.stringify(questions));

  console.log("\nAnswer validation");
  const foreign = await send(user, "/taste/answer", { category: "Coffee", options: [A, "Somewhere Else"], winner: A });
  check("a place this person never logged is rejected (400)", foreign.status === 400, JSON.stringify(foreign.body));
  const badWinner = await send(user, "/taste/answer", { category: "Coffee", options: [A, B], winner: C });
  check("a winner outside the options is rejected (400)", badWinner.status === 400, JSON.stringify(badWinner.body));
  const dupes = await send(user, "/taste/answer", { category: "Coffee", options: [A, A], winner: A });
  check("the same place twice is rejected (400)", dupes.status === 400, JSON.stringify(dupes.body));
  const lockedCategory = await send(user, "/taste/answer", { category: "Burger", options: [A, B], winner: A });
  check("answering in a category that isn't unlocked is rejected (400)", lockedCategory.status === 400, JSON.stringify(lockedCategory.body));

  console.log("\nRanking from answers");
  for (const body of [
    { options: [A, B, C], winner: A },
    { options: [A, B], winner: A },
    { options: [B, C], winner: B },
    { options: [A, C], winner: A },
    { options: [B, C], winner: B },
  ]) {
    const r = await send(user, "/taste/answer", { category: "Coffee", ...body });
    if (r.status !== 201) check("answer accepted", false, JSON.stringify(r.body));
  }
  const tie = await send(user, "/taste/answer", { category: "Coffee", options: [A, B], winner: null });
  check("'too close to call' is accepted", tie.status === 201, JSON.stringify(tie.body));

  const results = await get(user, "/taste/results?category=Coffee");
  const order = (results.body?.ranking ?? []).map((r) => r.venue);
  check("the ranking follows the answers (A > B > C)", order.join("|") === [A, B, C].join("|"), JSON.stringify(results.body?.ranking));
  check("the ranking reports real wins", results.body?.ranking?.[0]?.wins === 4, JSON.stringify(results.body?.ranking?.[0]));
  check("the ranking carries this person's own average score, unchanged", results.body?.ranking?.find((r) => r.venue === A)?.yourAverage === 8.5, JSON.stringify(results.body?.ranking));

  console.log("\nSuggestions");
  const suggestions = results.body?.suggestions ?? [];
  check("without an AI key, suggestions come from community logs", results.body?.source === "community" && results.body?.model === null, JSON.stringify({ source: results.body?.source, model: results.body?.model }));
  check("up to 3 suggestions", suggestions.length >= 1 && suggestions.length <= 3, JSON.stringify(suggestions));
  check("never suggests a place this person already logged", suggestions.every((s) => !mine.has(s.venue)), JSON.stringify(suggestions.map((s) => s.venue)));
  check("every suggestion explains itself", suggestions.every((s) => typeof s.reason === "string" && s.reason.length > 0), JSON.stringify(suggestions));
  const again = await get(user, "/taste/results?category=Coffee");
  check("results are cached while answers are unchanged", JSON.stringify(again.body?.suggestions) === JSON.stringify(suggestions), JSON.stringify(again.body?.suggestions));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
