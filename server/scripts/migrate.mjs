// Applies schema.sql against DATABASE_URL. Safe to re-run (all statements
// are CREATE TABLE/INDEX IF NOT EXISTS).
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Run: npx dotenv -e ../.env.local -- node scripts/migrate.mjs");
  process.exit(1);
}

// F08: if this ran with a .env.test loaded (ALLOW_TEST_DB=1), re-verify
// it actually looks like a test branch before touching it. No-op for the
// normal prod path (.env.local never sets ALLOW_TEST_DB).
if (process.env.ALLOW_TEST_DB === "1") {
  await import("./assertTestDatabase.mjs");
}

const sql = neon(url);
const schema = readFileSync(new URL("../schema.sql", import.meta.url), "utf8");

// Neon's tagged-template client runs one statement per call, so this needs
// to split on semicolons at statement boundaries. Splitting the raw file
// text isn't safe on its own: schema.sql's comments are real prose (not
// just field labels) and prose sentences contain semicolons too — one
// already broke this exact way in production (a comment reading "...one
// row per\n-- request; the partial unique index..." got cut mid-sentence,
// leaving a floating "the partial unique index..." fragment that Postgres
// tried to parse as SQL and rejected). Strip `--` line comments first, so
// only semicolons in actual SQL ever act as statement boundaries.
const withoutComments = schema
  .split("\n")
  .map((line) => {
    const idx = line.indexOf("--");
    return idx === -1 ? line : line.slice(0, idx);
  })
  .join("\n");

const statements = withoutComments
  .split(";")
  .map((s) => s.trim())
  .filter(Boolean);

for (const stmt of statements) {
  await sql.query(stmt);
  console.log("OK:", stmt.split("\n")[0].slice(0, 70));
}

console.log(`\nApplied ${statements.length} statements.`);
