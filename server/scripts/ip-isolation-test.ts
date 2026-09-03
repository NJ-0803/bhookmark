// Tests the actual keying logic of the global rate limiter across 100
// DIFFERENT IPs — not something reachable by hitting the live server with
// plain fetch, since every request from this machine genuinely originates
// from the same local address. Real distinct IPs would need 100 physical
// machines or a proxy fleet, which is out of scope here.
//
// What this DOES test for real: a standalone Express app running the exact
// same limiter config (createGlobalLimiter, imported — not reimplemented)
// with `trust proxy` enabled, driven by supertest with a distinct
// `X-Forwarded-For` header per simulated client. This is the standard way
// to test IP-based logic locally, and it exercises the real keyGenerator/skip
// code, not a mock of it.
//
// Run with: npx tsx scripts/ip-isolation-test.ts

import express from "express";
import request from "supertest";
import { createGlobalLimiter } from "../src/globalRateLimit";

let pass = 0;
let fail = 0;
function check(name: string, condition: boolean, detail = "") {
  if (condition) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}  ${detail}`);
  }
}

function buildApp() {
  const app = express();
  // Trust the X-Forwarded-For header — the real app (src/app.ts) now sets
  // this too, since it's genuinely deployed behind Vercel's edge network.
  app.set("trust proxy", true);
  app.use(createGlobalLimiter());
  app.get("/dishes/x/y", (_req, res) => res.json({ ok: true })); // exempted route
  app.get("/logs/mine", (_req, res) => res.json({ ok: true })); // non-exempt, unauthenticated
  return app;
}

async function main() {
  console.log("\n100 distinct simulated IPs, 5 unauthenticated requests each (500 total, 5x the 300/min budget)");
  {
    const app = buildApp();
    let failures = 0;
    for (let ip = 0; ip < 100; ip++) {
      const fakeIp = `10.0.${Math.floor(ip / 256)}.${ip % 256}`;
      for (let r = 0; r < 5; r++) {
        const res = await request(app).get("/logs/mine").set("X-Forwarded-For", fakeIp);
        if (res.status !== 200) failures++;
      }
    }
    check("all 500 requests succeed — each IP has its own budget", failures === 0, `${failures} of 500 were throttled`);
  }

  console.log("\nOne IP alone still gets capped once it exceeds the 300/min budget");
  {
    const app = buildApp();
    let lastStatus = 0;
    for (let r = 0; r < 305; r++) {
      const res = await request(app).get("/logs/mine").set("X-Forwarded-For", "10.9.9.9");
      lastStatus = res.status;
    }
    check("the 305th request from one repeated IP is throttled (429)", lastStatus === 429, `got ${lastStatus}`);
  }

  console.log("\nPublic /dishes reads stay exempt from the floor even under heavy single-IP load");
  {
    const app = buildApp();
    let failures = 0;
    for (let r = 0; r < 400; r++) {
      const res = await request(app).get("/dishes/x/y").set("X-Forwarded-For", "10.1.1.1");
      if (res.status !== 200) failures++;
    }
    check("400 requests from one IP to a public read all succeed", failures === 0, `${failures} of 400 were throttled`);
  }

  console.log("\nDifferent authenticated sessions from the SAME IP don't share a bucket either");
  {
    const app = buildApp();
    let failures = 0;
    for (let user = 0; user < 20; user++) {
      for (let r = 0; r < 20; r++) {
        const res = await request(app)
          .get("/logs/mine")
          .set("X-Forwarded-For", "10.5.5.5") // same IP for every user — an office network
          .set("Authorization", `Bearer fake-token-user-${user}`);
        if (res.status !== 200) failures++;
      }
    }
    check("20 users x 20 requests behind one shared IP all succeed (400 total)", failures === 0, `${failures} of 400 were throttled`);
  }

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
