// Real tests for Saved for later (/saves): private per-user bookmarks.
// Run with: node scripts/saves-test.mjs (requires the server on :4001,
// started against the test branch — see .env.test)
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
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

function randomTestIp() {
  const o = () => Math.floor(Math.random() * 256);
  return `10.${o()}.${o()}.${o()}`;
}

async function signUp(phone, ip) {
  const headers = { "X-Forwarded-For": ip };
  const req = await j("/auth/otp/request", { method: "POST", headers, body: JSON.stringify({ phone }) });
  const verify = await j("/auth/otp/verify", { method: "POST", headers, body: JSON.stringify({ phone, otp: req.body.devOtp, deviceLabel: "saves-test" }) });
  return verify.body;
}

const auth = (user) => ({ Authorization: `Bearer ${user.accessToken}` });

async function main() {
  const p = () => `+91900040${Math.floor(Math.random() * 9000 + 1000)}`;
  const alice = await signUp(p(), randomTestIp());
  const bob = await signUp(p(), randomTestIp());
  check("test accounts signed in", !!alice?.accessToken && !!bob?.accessToken, JSON.stringify({ alice: alice?.ok, bob: bob?.ok }));

  const dosa = { name: "Benne Masala Dosa", venue: "CTR (Shri Sagar)", area: "Malleshwaram", category: "Dosa & Idli", subtype: "Benne Dosa" };

  console.log("\nAccess");
  {
    const anon = await j("/saves");
    check("listing saves requires sign-in", anon.status === 401, JSON.stringify(anon));
    const anonPost = await j("/saves", { method: "POST", body: JSON.stringify(dosa) });
    check("saving requires sign-in", anonPost.status === 401, JSON.stringify(anonPost));
    const empty = await j("/saves", { headers: auth(alice) });
    check("a new account starts with no saves", empty.status === 200 && Array.isArray(empty.body.saves) && empty.body.saves.length === 0, JSON.stringify(empty.body));
  }

  console.log("\nSaving is idempotent and keyed by name + venue");
  {
    const first = await j("/saves", { method: "POST", headers: auth(alice), body: JSON.stringify(dosa) });
    check("first save creates it (201)", first.status === 201 && first.body.created === true, JSON.stringify(first));
    check("the save keeps the snapshot fields", first.body.save?.area === "Malleshwaram" && first.body.save?.category === "Dosa & Idli" && typeof first.body.save?.savedAt === "number", JSON.stringify(first.body.save));

    const again = await j("/saves", {
      method: "POST",
      headers: auth(alice),
      body: JSON.stringify({ ...dosa, name: "  benne   masala DOSA ", venue: "ctr (shri sagar)" }),
    });
    check("re-saving with different case/spacing is not a duplicate (200, created=false)", again.status === 200 && again.body.created === false, JSON.stringify(again));
    check("re-saving keeps the original save time", again.body.save?.savedAt === first.body.save?.savedAt, JSON.stringify({ a: first.body.save?.savedAt, b: again.body.save?.savedAt }));

    const list = await j("/saves", { headers: auth(alice) });
    check("alice has exactly one save", list.body.saves?.length === 1, JSON.stringify(list.body));
  }

  console.log("\nPrivacy");
  {
    const bobList = await j("/saves", { headers: auth(bob) });
    check("bob cannot see alice's saves", bobList.status === 200 && bobList.body.saves.length === 0, JSON.stringify(bobList.body));
    const bobDelete = await j("/saves", { method: "DELETE", headers: auth(bob), body: JSON.stringify({ name: dosa.name, venue: dosa.venue }) });
    check("bob removing the same dish removes nothing of alice's", bobDelete.status === 200 && bobDelete.body.removed === false, JSON.stringify(bobDelete.body));
    const aliceStill = await j("/saves", { headers: auth(alice) });
    check("alice's save survives bob's delete", aliceStill.body.saves?.length === 1, JSON.stringify(aliceStill.body));
  }

  console.log("\nValidation");
  {
    const noVenue = await j("/saves", { method: "POST", headers: auth(alice), body: JSON.stringify({ name: "Filter Coffee" }) });
    check("a save without a venue is rejected (400)", noVenue.status === 400, JSON.stringify(noVenue));
    const blank = await j("/saves", { method: "POST", headers: auth(alice), body: JSON.stringify({ name: "   ", venue: "Somewhere" }) });
    check("a blank dish name is rejected (400)", blank.status === 400, JSON.stringify(blank));
    const tooLong = await j("/saves", { method: "POST", headers: auth(alice), body: JSON.stringify({ name: "x".repeat(121), venue: "Somewhere" }) });
    check("an over-long dish name is rejected (400)", tooLong.status === 400, JSON.stringify(tooLong));
    const badDelete = await j("/saves", { method: "DELETE", headers: auth(alice), body: JSON.stringify({}) });
    check("a delete without a dish is rejected (400)", badDelete.status === 400, JSON.stringify(badDelete));
  }

  console.log("\nOrdering and removal");
  {
    await new Promise((r) => setTimeout(r, 5));
    const coffee = { name: "Degree Coffee", venue: "Vidyarthi Bhavan", area: "Basavanagudi", category: "Coffee", subtype: "Filter Coffee" };
    const second = await j("/saves", { method: "POST", headers: auth(alice), body: JSON.stringify(coffee) });
    check("a second dish saves", second.status === 201, JSON.stringify(second));
    const ordered = await j("/saves", { headers: auth(alice) });
    check("saves list newest first", ordered.body.saves?.[0]?.name === "Degree Coffee" && ordered.body.saves?.[1]?.name === "Benne Masala Dosa", JSON.stringify(ordered.body.saves?.map((s) => s.name)));

    const removed = await j("/saves", { method: "DELETE", headers: auth(alice), body: JSON.stringify({ name: "BENNE MASALA DOSA", venue: " CTR (Shri Sagar) " }) });
    check("removing is case/space-insensitive (removed=true)", removed.status === 200 && removed.body.removed === true, JSON.stringify(removed.body));
    const removedAgain = await j("/saves", { method: "DELETE", headers: auth(alice), body: JSON.stringify({ name: dosa.name, venue: dosa.venue }) });
    check("removing twice is harmless (removed=false)", removedAgain.status === 200 && removedAgain.body.removed === false, JSON.stringify(removedAgain.body));
    const left = await j("/saves", { headers: auth(alice) });
    check("only the coffee remains", left.body.saves?.length === 1 && left.body.saves[0].name === "Degree Coffee", JSON.stringify(left.body.saves));

    await j("/saves", { method: "DELETE", headers: auth(alice), body: JSON.stringify({ name: coffee.name, venue: coffee.venue }) });
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
