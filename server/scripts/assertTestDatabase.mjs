// F08 (implementation brief, 2026-09-08): "Add isolated test configuration
// and a fail-closed database target guard." Project notes confirm there
// was only ever one Neon database, and every integration script connected
// to it directly — meaning every past test run, however careful about
// cleaning up afterward, was writing to production.
//
// Import this (or run it directly) before any script that creates,
// mutates or deletes data for test purposes. It refuses to continue
// unless BOTH:
//   1. DATABASE_URL is set and its host clearly names a non-production
//      branch (contains "test", "dev" or "sandbox" — matching the branch
//      name this project's setup asks you to create: see server/.env.test.example)
//   2. ALLOW_TEST_DB=1 is explicitly set alongside it
//
// Two independent conditions on purpose: a coincidentally-test-sounding
// prod URL alone won't pass, and the opt-in flag alone (e.g. copy-pasted
// into the wrong .env file) won't either.
const url = process.env.DATABASE_URL ?? "";
const looksLikeTestBranch = /test|dev|sandbox/i.test(url);
const explicitlyAllowed = process.env.ALLOW_TEST_DB === "1";

if (!url) {
  console.error("[assertTestDatabase] DATABASE_URL is not set. Refusing to run — this guard is fail-closed.");
  process.exit(1);
}

if (!looksLikeTestBranch || !explicitlyAllowed) {
  console.error(
    "[assertTestDatabase] DATABASE_URL does not look like an isolated test database, or ALLOW_TEST_DB=1 is missing.\n" +
      "Refusing to run against what may be production. See server/.env.test.example for setup, then run scripts via:\n" +
      "  npx dotenv -e ../.env.test -- node scripts/<script>.mjs"
  );
  process.exit(1);
}

console.log(`[assertTestDatabase] OK — DATABASE_URL targets a recognized test branch (host contains a test/dev/sandbox marker).`);
