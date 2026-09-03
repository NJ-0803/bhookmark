// Applies schema.sql against DATABASE_URL. Safe to re-run (all statements
// are CREATE TABLE/INDEX IF NOT EXISTS).
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Run: npx dotenv -e ../.env.local -- node scripts/migrate.mjs");
  process.exit(1);
}

const sql = neon(url);
const schema = readFileSync(new URL("../schema.sql", import.meta.url), "utf8");

// Neon's tagged-template client runs one statement per call; split on
// semicolons at statement boundaries (fine here since schema.sql has no
// semicolons inside string literals).
const statements = schema
  .split(";")
  .map((s) => s.trim())
  .filter(Boolean);

for (const stmt of statements) {
  await sql.query(stmt);
  console.log("OK:", stmt.split("\n")[0].slice(0, 70));
}

console.log(`\nApplied ${statements.length} statements.`);
