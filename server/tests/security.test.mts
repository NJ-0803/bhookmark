import assert from "node:assert/strict";
import { test } from "node:test";
import jwt from "jsonwebtoken";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { proxyTrust, permittedOrigin } from "../src/network";
import { bookmarkSchema } from "../src/bookmarks";
import { createRefreshRotation } from "../src/db";
process.env.JWT_ACCESS_SECRET = "isolated-security-access";
process.env.JWT_REFRESH_SECRET = "isolated-security-refresh";
const { issueAccessToken, verifyAccessToken, issueRefreshToken, verifyRefreshToken } = await import("../src/auth");

test("network trust is deployment-aware, never trust-all by default", () => {
  assert.equal(proxyTrust({}), false);
  assert.equal(proxyTrust({ VERCEL: "1" }), 1);
  assert.deepEqual(proxyTrust({ TRUST_PROXY_CIDRS: "127.0.0.1/32, ::1/128" }), ["127.0.0.1/32", "::1/128"]);
  assert.equal(permittedOrigin("https://unrelated.vercel.app", { NODE_ENV: "production" }), false);
  assert.equal(permittedOrigin("http://localhost:5173", { NODE_ENV: "production" }), false);
  assert.equal(permittedOrigin("http://localhost:5173", {}), true);
  assert.equal(permittedOrigin("https://preview.example", { NODE_ENV: "production", ALLOWED_ORIGINS: "https://preview.example" }), true);
});

test("JWTs pin HS256, validate payload shape and preserve original login time", () => {
  const oldLogin = Math.floor(Date.now() / 1000) - 86400;
  assert.equal(verifyAccessToken(issueAccessToken("alice", "user", oldLogin, "device")).authTime, oldLogin);
  const refresh = verifyRefreshToken(issueRefreshToken("family", "jti", oldLogin));
  assert.equal(refresh.authTime, oldLogin);
  assert.equal(verifyRefreshToken(issueRefreshToken("family", "next", refresh.authTime)).authTime, oldLogin);
  const legacy = jwt.sign({ familyId: "family", jti: "old" }, process.env.JWT_REFRESH_SECRET!, { expiresIn: 60 });
  assert.equal(verifyRefreshToken(legacy).authTime, 0, "legacy must not silently become a fresh login");
  assert.throws(() => verifyAccessToken(jwt.sign({ sub: "alice", role: "admin", authTime: oldLogin, deviceId: "x" }, process.env.JWT_ACCESS_SECRET!, { algorithm: "HS384" })));
  assert.throws(() => verifyAccessToken(jwt.sign({ sub: "alice" }, process.env.JWT_ACCESS_SECRET!)));
  assert.throws(() => verifyRefreshToken(jwt.sign({ familyId: "f", jti: "x", authTime: "today" }, process.env.JWT_REFRESH_SECRET!)));
});

test("refresh compare-and-swap admits one winner without revoking it", async () => {
  const pg = new PGlite();
  try {
    await pg.exec(readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));
    await pg.exec("INSERT INTO users (id, created_at) VALUES ('alice', 1); INSERT INTO devices(id,user_id,family_id,label,created_at,last_seen_at) VALUES ('d','alice','f','test',1,1); INSERT INTO refresh_families(family_id,user_id,device_id,current_jti) VALUES ('f','alice','d','old')");
    const connect = () => (strings: TemplateStringsArray, ...params: unknown[]) => {
      const text = strings.reduce((acc, s, i) => acc + (i ? `$${i}` : "") + s, "");
      return pg.query(text, params).then(r => r.rows);
    };
    const rotate = createRefreshRotation(connect as any);
    const outcomes = await Promise.all([rotate("f", "old", "a"), rotate("f", "old", "b")]);
    assert.equal(outcomes.filter(Boolean).length, 1);
    const { rows } = await pg.query<{ current_jti: string; previous_jti: string; revoked: boolean }>("SELECT * FROM refresh_families WHERE family_id='f'");
    assert.equal(rows[0].previous_jti, "old"); assert.equal(rows[0].revoked, false);
    assert.equal(await rotate("f", "old", "c"), false);
    await pg.exec("UPDATE refresh_families SET revoked=true WHERE family_id='f'");
    assert.equal(await rotate("f", rows[0].current_jti, "c"), false);
  } finally { await pg.close(); }
});

test("reference links have the same length bound as the form", () => {
  const b = { restaurantId: "manual:a", restaurantName: "Example", name: "Dish", referenceUrl: "https://example.com/" + "a".repeat(2000) };
  assert.equal(bookmarkSchema.safeParse(b).success, false);
});

test("refresh grace rejects overlap and older in-flight tokens without accepting replay", async () => {
  const { refreshDisposition } = await import("../src/sessionSecurity");
  const family = { currentJti: "newest", rotatedAt: 1000 };
  assert.equal(refreshDisposition(family, "newest", 1001), "current");
  assert.equal(refreshDisposition(family, "old", 1001), "conflict");
  assert.equal(refreshDisposition(family, "older-in-flight", 1002), "conflict");
  assert.equal(refreshDisposition(family, "old", 31_000), "replay");
  assert.equal(refreshDisposition({ currentJti: "newest" }, "old", 1001), "replay");
});

test("Google profile requires a verified email and stable subject", async () => {
  const { verifiedGoogleIdentity } = await import("../src/sessionSecurity");
  assert.deepEqual(verifiedGoogleIdentity({ sub: "stable-sub", email: "example@example.com", email_verified: true }), { sub: "stable-sub", email: "example@example.com" });
  for (const value of [undefined, {}, { sub: "x", email: "x@example.com" }, { sub: "x", email: "x@example.com", email_verified: false }]) {
    assert.throws(() => verifiedGoogleIdentity(value));
  }
});
