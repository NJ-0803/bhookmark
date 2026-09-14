// Checks the taste game's AI client in isolation. Failure paths always run;
// the live check runs only when GROQ_API_KEY is set.
// Run with: npx tsx scripts/taste-ai-check.ts
import { TASTE_AI_MODEL, pickWithGroq, type TasteCandidate } from "../src/tasteAi";

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  ${detail}`}`);
};

const candidates: TasteCandidate[] = [
  { id: "c1", venue: "Cafe One", area: "Indiranagar", communityAverage: 8.4, logCount: 12 },
  { id: "c2", venue: "Cafe Two", area: "Jayanagar", communityAverage: 6.1, logCount: 3 },
  { id: "c3", venue: "Cafe Three", area: "Koramangala", communityAverage: null, logCount: 0 },
];
const input = { category: "Coffee", ranking: [{ venue: "Nandan Coffee", strength: 100 }, { venue: "Starbucks", strength: 40 }], candidates };

async function main() {
  console.log("\nFailure paths fall back (null) instead of breaking the game");
  check("no key → null", (await pickWithGroq(input, { apiKey: "" })) === null);
  check("no candidates → null", (await pickWithGroq({ ...input, candidates: [] }, { apiKey: "gsk_anything" })) === null);
  const t0 = Date.now();
  const bad = await pickWithGroq(input, { apiKey: "gsk_invalid_key_for_testing" });
  check("an invalid key → null, quickly", bad === null && Date.now() - t0 < 5000, `took ${Date.now() - t0}ms`);
  const t1 = Date.now();
  check("a timeout → null", (await pickWithGroq(input, { apiKey: "gsk_invalid_key_for_testing", timeoutMs: 1 })) === null && Date.now() - t1 < 1000);

  if (process.env.GROQ_API_KEY) {
    console.log(`\nLive call to ${TASTE_AI_MODEL}`);
    const t2 = Date.now();
    const picks = await pickWithGroq(input);
    const ms = Date.now() - t2;
    check("returns picks", Array.isArray(picks) && picks.length > 0, JSON.stringify(picks));
    check("every pick is a real candidate", (picks ?? []).every((p) => candidates.some((c) => c.id === p.id)), JSON.stringify(picks));
    check("every pick has a reason", (picks ?? []).every((p) => p.reason.length > 0), JSON.stringify(picks));
    check("answers within 4 seconds", ms < 4000, `${ms}ms`);
    console.log(`    latency ${ms}ms, picks: ${JSON.stringify(picks)}`);
  } else {
    console.log("\n(GROQ_API_KEY not set — live check skipped)");
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
