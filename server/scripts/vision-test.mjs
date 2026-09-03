// Real, runnable tests for the AI dish-recognition backend (brief 1.3).
// No ANTHROPIC_API_KEY is configured in this environment (confirmed via
// `vercel env ls` — it doesn't exist in production or locally), so these
// tests exercise every path that DOESN'T require a live vendor call: auth,
// payload validation, the honest "not configured" response, the eval-log
// round trip for corrections, and the daily-cap bookkeeping helper. The
// actual vendor call path (detectDish() reaching Anthropic) is written but
// genuinely untested end-to-end until a real key is added — that's called
// out explicitly rather than faked.
// Run with: node scripts/vision-test.mjs (requires the server on :4001)
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

async function signUp(phone) {
  const req = await j("/auth/otp/request", { method: "POST", body: JSON.stringify({ phone }) });
  const verify = await j("/auth/otp/verify", { method: "POST", body: JSON.stringify({ phone, otp: req.body.devOtp, deviceLabel: "vision-test" }) });
  return verify.body;
}

// A tiny valid base64 PNG (1x1 transparent pixel) — enough to satisfy schema
// validation; content doesn't matter for these tests since detectDish()
// short-circuits before ever reaching Anthropic when no key is configured.
const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

async function main() {
  console.log("\nGET /logs/detect/status — honestly reports vision is not configured");
  {
    const phone = `+91900010${Math.floor(Math.random() * 9000 + 1000)}`;
    const user = await signUp(phone);
    const status = await j("/logs/detect/status", { headers: { Authorization: `Bearer ${user.accessToken}` } });
    check("responds ok:true", status.body.ok === true, JSON.stringify(status.body));
    check("configured is false (no ANTHROPIC_API_KEY in this environment)", status.body.configured === false, JSON.stringify(status.body));

    const noAuth = await j("/logs/detect/status");
    check("status endpoint requires auth (401 without a token)", noAuth.status === 401, JSON.stringify(noAuth.body));
  }

  console.log("\nPOST /logs/detect — requires auth");
  {
    const noAuth = await j("/logs/detect", { method: "POST", body: JSON.stringify({ imageBase64: TINY_PNG_BASE64, mimeType: "image/png" }) });
    check("401 without a token", noAuth.status === 401, JSON.stringify(noAuth.body));
  }

  console.log("\nPOST /logs/detect — rejects malformed payloads with 400, never crashes");
  {
    const phone = `+91900011${Math.floor(Math.random() * 9000 + 1000)}`;
    const user = await signUp(phone);
    const auth = { Authorization: `Bearer ${user.accessToken}` };

    const missingImage = await j("/logs/detect", { method: "POST", headers: auth, body: JSON.stringify({ mimeType: "image/png" }) });
    check("missing imageBase64 -> 400", missingImage.status === 400, JSON.stringify(missingImage.body));

    const badMime = await j("/logs/detect", { method: "POST", headers: auth, body: JSON.stringify({ imageBase64: TINY_PNG_BASE64, mimeType: "application/pdf" }) });
    check("unsupported mimeType -> 400 (only jpeg/png/webp accepted)", badMime.status === 400, JSON.stringify(badMime.body));

    const emptyImage = await j("/logs/detect", { method: "POST", headers: auth, body: JSON.stringify({ imageBase64: "", mimeType: "image/png" }) });
    check("empty imageBase64 -> 400", emptyImage.status === 400, JSON.stringify(emptyImage.body));
  }

  console.log("\nPOST /logs/detect — without a configured vendor key, fails HONESTLY (no fabricated confidence)");
  {
    const phone = `+91900012${Math.floor(Math.random() * 9000 + 1000)}`;
    const user = await signUp(phone);
    const res = await j("/logs/detect", {
      method: "POST",
      headers: { Authorization: `Bearer ${user.accessToken}` },
      body: JSON.stringify({ imageBase64: TINY_PNG_BASE64, mimeType: "image/png" }),
    });
    check("responds 200 (a missing vendor key is not a server error)", res.status === 200, JSON.stringify(res.body));
    check("ok is false", res.body.ok === false, JSON.stringify(res.body));
    check("error is the honest 'vision_not_configured' code, not a fake result", res.body.error === "vision_not_configured", JSON.stringify(res.body));
    check("response contains NO candidates array (nothing fabricated)", !("candidates" in res.body), JSON.stringify(res.body));
    check("response contains NO confidence value anywhere", !JSON.stringify(res.body).includes("confidence"), JSON.stringify(res.body));
  }

  console.log("\nPOST /logs/detect — the daily-cap counter is NOT incremented when short-circuited by a missing key");
  {
    // Regression guard for the deliberate design choice in routes/logs.ts:
    // the cap should only count requests that actually reach the vendor, so
    // a string of failed attempts (e.g. before a key is ever configured)
    // shouldn't burn through a real user's quota once one is added later.
    const phone = `+91900013${Math.floor(Math.random() * 9000 + 1000)}`;
    const user = await signUp(phone);
    const auth = { Authorization: `Bearer ${user.accessToken}` };
    const attempts = await Promise.all(
      Array.from({ length: 20 }, () => j("/logs/detect", { method: "POST", headers: auth, body: JSON.stringify({ imageBase64: TINY_PNG_BASE64, mimeType: "image/png" }) }))
    );
    const allNotConfigured = attempts.every((r) => r.status === 200 && r.body.error === "vision_not_configured");
    check("20 rapid attempts (well past the 15/day cap) ALL get the same honest response, none 429", allNotConfigured, JSON.stringify(attempts.filter((r) => r.status !== 200)));
  }

  console.log("\nPOST /logs/correction — requires auth, validates payload, and actually persists (real DB round trip)");
  {
    const noAuth = await j("/logs/correction", { method: "POST", body: JSON.stringify({ aiSuggestion: {}, userCorrection: {} }) });
    check("401 without a token", noAuth.status === 401, JSON.stringify(noAuth.body));

    const phone = `+91900014${Math.floor(Math.random() * 9000 + 1000)}`;
    const user = await signUp(phone);
    const auth = { Authorization: `Bearer ${user.accessToken}` };

    const missingFields = await j("/logs/correction", { method: "POST", headers: auth, body: JSON.stringify({}) });
    // aiSuggestion/userCorrection are z.unknown() — even {} satisfies the
    // schema shape-wise, so an empty body with no keys at all is what
    // should actually fail here (zod requires the keys to be present).
    check("missing required keys entirely -> 400", missingFields.status === 400, JSON.stringify(missingFields.body));

    const marker = `qa-marker-${crypto.randomUUID()}`;
    const submit = await j("/logs/correction", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        aiSuggestion: { category: "Burger", subtype: "Chicken", name: "Chicken Burger", confidence: 62 },
        userCorrection: { category: "Burger", subtype: "Veg", name: marker },
      }),
    });
    check("correction submission succeeds", submit.status === 200 && submit.body.ok, JSON.stringify(submit.body));

    // Read back via the dev-only debug route to prove it actually landed in
    // Postgres, not just returned ok:true without persisting anything.
    const listed = await j("/dev/ai-corrections");
    const found = listed.body.corrections?.some((c) => JSON.stringify(c.userCorrection).includes(marker));
    check("the submitted correction is actually persisted and readable back from the DB", found === true, `looked for marker ${marker}, got ${listed.body.corrections?.length} rows`);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  console.log(
    "\nNOTE: the actual vendor call inside detectDish() (real Claude vision analysis of a genuine photo) is " +
    "NOT exercised by this suite — there is no ANTHROPIC_API_KEY configured anywhere in this project yet. " +
    "Everything up to that boundary (auth, schema validation, honest failure mode, rate-limit bookkeeping, " +
    "and the correction eval-log round trip) is real and passing. Add a real key and re-run against a real " +
    "photo to validate the vendor-call path before relying on it in production."
  );
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
