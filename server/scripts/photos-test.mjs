// Real tests for log photos (/photos, POST /logs photoUrl, /dishes/score
// photos). Uploads go to the real Blob store; every test blob is deleted at
// the end. Run with (from server/):
//   BLOB_READ_WRITE_TOKEN=... node --env-file=.env.test scripts/photos-test.mjs
// against a server on :4001 started with the same token.
import { randomUUID } from "node:crypto";
import { del } from "@vercel/blob";

const BASE = "http://localhost:4001";
let pass = 0;
let fail = 0;
const uploaded = [];

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
  const verify = await j("/auth/otp/verify", { method: "POST", headers, body: JSON.stringify({ phone, otp: req.body.devOtp, deviceLabel: "photos-test" }) });
  // Every later request carries this IP too, so logs don't all arrive from
  // 127.0.0.1 and trip the real multi-account-network hold.
  return { ...verify.body, ip };
}

// A real, valid 1x1 JPEG.
const TINY_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/yQALCAABAAEBAREA/8wABgAQEAX/2gAIAQEAAD8A0s8g/9k=",
  "base64"
);

async function upload(user, bytes, contentType = "image/jpeg") {
  const res = await fetch(`${BASE}/photos`, {
    method: "POST",
    headers: { Authorization: `Bearer ${user.accessToken}`, "Content-Type": contentType, "X-Forwarded-For": user.ip },
    body: bytes,
  });
  let body;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (body?.url) uploaded.push(body.url);
  return { status: res.status, body };
}

function logBody(venue, overrides = {}) {
  return {
    category: "Burger",
    subtype: "Veg",
    name: "QA Photo Burger",
    venue,
    verdict: "loved",
    score: 8,
    note: "photo test",
    visibility: "public",
    evidence: { livePhoto: true, receipt: false, location: null },
    ...overrides,
  };
}

const postLog = (user, body) =>
  j("/logs", { method: "POST", headers: { Authorization: `Bearer ${user.accessToken}`, "Idempotency-Key": randomUUID(), "X-Forwarded-For": user.ip }, body: JSON.stringify(body) });

async function main() {
  const p = () => `+91900090${Math.floor(Math.random() * 9000 + 1000)}`;
  const [alice, bob, carol] = [await signUp(p()), await signUp(p()), await signUp(p())];
  check("test accounts signed in", !!alice?.accessToken && !!bob?.accessToken && !!carol?.accessToken);
  const venue = `QA Photo Venue ${Date.now()}`;

  console.log("\nUploading");
  {
    const anon = await fetch(`${BASE}/photos`, { method: "POST", headers: { "Content-Type": "image/jpeg" }, body: TINY_JPEG });
    check("uploading requires sign-in", anon.status === 401, String(anon.status));
    const fake = await upload(alice, Buffer.from("definitely not an image"), "image/jpeg");
    check("a non-image with an image content type is rejected (400)", fake.status === 400, JSON.stringify(fake));
    const huge = await upload(alice, Buffer.concat([TINY_JPEG, Buffer.alloc(1.6 * 1024 * 1024)]));
    check("a photo over 1.5 MB is rejected (413)", huge.status === 413, JSON.stringify(huge));
    const ok = await upload(alice, TINY_JPEG);
    check("a real JPEG uploads (201) to the Blob store", ok.status === 201 && /\.public\.blob\.vercel-storage\.com\/logs\//.test(ok.body?.url ?? ""), JSON.stringify(ok));
    const served = ok.body?.url ? await fetch(ok.body.url) : null;
    check("the uploaded photo is publicly readable", served?.status === 200 && (served.headers.get("content-type") ?? "").startsWith("image/jpeg"), String(served?.status));
  }

  console.log("\nAttaching to logs");
  const alicePhoto = uploaded[0];
  {
    const stolen = await postLog(bob, logBody(venue, { photoUrl: alicePhoto }));
    check("a log can't attach someone else's photo (400)", stolen.status === 400, JSON.stringify(stolen.body));
    const random = await postLog(bob, logBody(venue, { photoUrl: "https://example.com/cat.jpg" }));
    check("a log can't attach a photo that wasn't uploaded here (400)", random.status === 400, JSON.stringify(random.body));
    const own = await postLog(alice, logBody(venue, { photoUrl: alicePhoto }));
    check("a log attaches its own uploaded photo", own.status === 201 && own.body?.log?.photoUrl === alicePhoto, JSON.stringify(own.body));
    globalThis.aliceLogId = own.body?.log?.id;

    const carolPhoto = (await upload(carol, TINY_JPEG)).body?.url;
    const privateLog = await postLog(carol, logBody(venue, { photoUrl: carolPhoto, visibility: "private" }));
    check("a private log can keep a photo too", privateLog.status === 201 && privateLog.body?.log?.photoUrl === carolPhoto, JSON.stringify(privateLog.body));
    globalThis.carolPhoto = carolPhoto;
  }

  console.log("\nShowing to other people");
  const scorePath = `/dishes/score?${new URLSearchParams({ venue, category: "Burger", subtype: "Veg", name: "QA Photo Burger" })}`;
  {
    const score = await j(scorePath, { headers: { Authorization: `Bearer ${bob.accessToken}` } });
    const urls = (score.body?.photos ?? []).map((ph) => ph.url);
    check("another user sees the public log's photo on the dish", urls.includes(alicePhoto), JSON.stringify(score.body?.photos));
    check("a private log's photo is never shown to others", !urls.includes(globalThis.carolPhoto), JSON.stringify(urls));
  }

  console.log("\nReporting");
  {
    const own = await j("/photos/report", { method: "POST", headers: { Authorization: `Bearer ${alice.accessToken}` }, body: JSON.stringify({ logId: globalThis.aliceLogId }) });
    check("you can't report your own photo (400)", own.status === 400, JSON.stringify(own.body));
    const first = await j("/photos/report", { method: "POST", headers: { Authorization: `Bearer ${bob.accessToken}` }, body: JSON.stringify({ logId: globalThis.aliceLogId }) });
    check("one report doesn't hide it yet", first.status === 200 && first.body?.hidden === false, JSON.stringify(first.body));
    const again = await j("/photos/report", { method: "POST", headers: { Authorization: `Bearer ${bob.accessToken}` }, body: JSON.stringify({ logId: globalThis.aliceLogId }) });
    check("the same person reporting twice still counts once", again.body?.hidden === false, JSON.stringify(again.body));
    const second = await j("/photos/report", { method: "POST", headers: { Authorization: `Bearer ${carol.accessToken}` }, body: JSON.stringify({ logId: globalThis.aliceLogId }) });
    check("a second different person hides it", second.body?.hidden === true, JSON.stringify(second.body));
    const after = await j(scorePath, { headers: { Authorization: `Bearer ${bob.accessToken}` } });
    check("a hidden photo no longer shows on the dish", !(after.body?.photos ?? []).some((ph) => ph.url === alicePhoto), JSON.stringify(after.body?.photos));
    const missing = await j("/photos/report", { method: "POST", headers: { Authorization: `Bearer ${bob.accessToken}` }, body: JSON.stringify({ logId: "nope" }) });
    check("reporting a log with no photo is a 404", missing.status === 404, JSON.stringify(missing.body));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
}

main()
  .catch((e) => {
    console.error(e);
    fail++;
  })
  .finally(async () => {
    if (uploaded.length && process.env.BLOB_READ_WRITE_TOKEN) {
      await del(uploaded, { token: process.env.BLOB_READ_WRITE_TOKEN }).catch((e) => console.log("cleanup failed:", String(e)));
      console.log(`(deleted ${uploaded.length} test photo${uploaded.length === 1 ? "" : "s"} from the Blob store)`);
    }
    process.exit(fail > 0 ? 1 : 0);
  });
