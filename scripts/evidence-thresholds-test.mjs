// Real unit test for the evidence-threshold pure function — the client-side
// gate that stops "signature craving" claims from firing on one lucky order.
// Run with: npx tsx scripts/evidence-thresholds-test.mjs
import { signatureCraving } from "../src/evidenceThresholds.ts";

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

function log(category, venue, verdict = "loved") {
  return { id: Math.random().toString(), category, subtype: "x", name: "x", venue, verdict, score: 8, note: "", verified: false, status: "published", createdAt: Date.now() };
}

console.log("\nZero logs — insufficient, no crash");
{
  const r = signatureCraving([]);
  check("tier is insufficient", r.tier === "insufficient", r.tier);
  check("logsSeen is 0", r.logsSeen === 0, r.logsSeen);
}

console.log("\n1-2 logs in a category — still insufficient (below the 3-log early-hint floor)");
{
  const r = signatureCraving([log("Burger", "A"), log("Burger", "B")]);
  check("tier is insufficient", r.tier === "insufficient", r.tier);
  check("logsSeen reflects the 2 logs", r.logsSeen === 2, r.logsSeen);
}

console.log("\nExactly 3 logs in one category — the brief's 'early taste hint' tier");
{
  const r = signatureCraving([log("Burger", "A"), log("Burger", "A"), log("Burger", "B")]);
  check("tier is early", r.tier === "early", r.tier);
  check("category is Burger", r.category === "Burger", r.category);
  check("logsSeen is 3", r.logsSeen === 3, r.logsSeen);
}

console.log("\n4 logs, only 2 venues — still early, NOT unlocked (venue diversity requirement holds even past 3 logs)");
{
  const r = signatureCraving([log("Burger", "A"), log("Burger", "A"), log("Burger", "A"), log("Burger", "B")]);
  check("tier is early, not unlocked", r.tier === "early", r.tier);
}

console.log("\n5 logs across only 2 venues — NOT unlocked (venue floor is 3, log count alone isn't enough)");
{
  const r = signatureCraving([log("Burger", "A"), log("Burger", "A"), log("Burger", "A"), log("Burger", "B"), log("Burger", "B")]);
  check("tier is early, not unlocked", r.tier === "early", r.tier);
}

console.log("\n5 logs across 3 venues — unlocked, 'developing' band");
{
  const r = signatureCraving([log("Burger", "A"), log("Burger", "A"), log("Burger", "B"), log("Burger", "C"), log("Burger", "C")]);
  check("tier is unlocked", r.tier === "unlocked", r.tier);
  check("band is developing", r.band === "developing", r.band);
}

console.log("\n15 logs across 6 venues — unlocked, 'strong' band");
{
  const logs = [];
  for (let i = 0; i < 15; i++) logs.push(log("Burger", `venue-${i % 6}`));
  const r = signatureCraving(logs);
  check("tier is unlocked", r.tier === "unlocked", r.tier);
  check("band is strong", r.band === "strong", r.band);
}

console.log("\nRemoved logs are excluded from the count");
{
  const logs = [log("Burger", "A"), log("Burger", "B"), log("Burger", "C"), log("Burger", "D"), log("Burger", "E")];
  logs[4].status = "removed";
  const r = signatureCraving(logs);
  check("removed log doesn't count toward the 5-log threshold", r.tier === "early", r.tier);
}

console.log("\nMultiple categories — the most-logged category wins, not an average across all");
{
  const logs = [log("Burger", "A"), log("Burger", "A"), log("Burger", "A"), log("Pizza", "X")];
  const r = signatureCraving(logs);
  check("early tier picks Burger (3 logs) over Pizza (1 log)", r.tier === "early" && r.category === "Burger", JSON.stringify(r));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
