// F08 (implementation brief, 2026-09-08): "Add isolated test configuration
// and a fail-closed database target guard." Project notes confirm there
// was only ever one Neon database, and every integration script connected
// to it directly — meaning every past test run, however careful about
// cleaning up afterward, was writing to production.
//
// Import this (or run it directly) before any script that creates,
// mutates or deletes data for test purposes. It refuses to continue
// unless BOTH:
//   1. DATABASE_URL is set and its host does NOT match the known
//      production host below
//   2. ALLOW_TEST_DB=1 is explicitly set alongside it
//
// 2026-09-11: the original version of this guard checked whether the URL
// "looked like" a test branch (host containing "test"/"dev"/"sandbox").
// That doesn't work on Neon — a branch actually named "test" (created via
// `neon branches create --name test`) gets an opaque, randomly-generated
// endpoint hostname (e.g. "ep-bitter-shadow-....neon.tech") completely
// unrelated to the branch name, so the very first real test branch this
// project created failed the guard it was supposed to pass. Checking
// against a known-bad value (the actual production host) is reliable
// regardless of what a branch happens to be named; checking for a
// hopeful-looking value in an opaque hostname never was.
//
// Two independent conditions still on purpose: accidentally pointing
// DATABASE_URL at prod (e.g. sourcing the wrong .env file) is caught by
// condition 1 even if ALLOW_TEST_DB=1 leaked in from that same wrong file;
// the opt-in flag alone isn't enough either, so a coincidentally-fine URL
// doesn't silently permit a mutation.
import { isKnownProductionUrl } from "./prodHost.mjs";

const url = process.env.DATABASE_URL ?? "";
const isKnownProduction = isKnownProductionUrl(url);
const explicitlyAllowed = process.env.ALLOW_TEST_DB === "1";

if (!url) {
  console.error("[assertTestDatabase] DATABASE_URL is not set. Refusing to run — this guard is fail-closed.");
  process.exit(1);
}

if (isKnownProduction || !explicitlyAllowed) {
  console.error(
    "[assertTestDatabase] DATABASE_URL matches the known production host, or ALLOW_TEST_DB=1 is missing.\n" +
      "Refusing to run against what may be production. See server/.env.test.example for setup, then run scripts via:\n" +
      "  npx dotenv -e .env.test -- node scripts/<script>.mjs"
  );
  process.exit(1);
}

console.log(`[assertTestDatabase] OK — DATABASE_URL does not match the known production host, and ALLOW_TEST_DB=1 is set.`);
