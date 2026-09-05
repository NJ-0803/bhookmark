// Real tests for Phase 4: Friends, Circles, Craving Rooms, and Lists —
// the backend that replaces what was previously 100% hardcoded mock data
// in FoodCircles.tsx / CravingRoom.tsx / RemixableLists.tsx.
// Run with: node scripts/phase4-test.mjs (requires the server on :4001)
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

function randomTestIp() {
  const o = () => Math.floor(Math.random() * 256);
  return `10.${o()}.${o()}.${o()}`;
}

async function signUp(phone, ip) {
  const headers = { "X-Forwarded-For": ip };
  const req = await j("/auth/otp/request", { method: "POST", headers, body: JSON.stringify({ phone }) });
  const verify = await j("/auth/otp/verify", { method: "POST", headers, body: JSON.stringify({ phone, otp: req.body.devOtp, deviceLabel: "phase4-test" }) });
  return verify.body;
}

function auth(user) {
  return { Authorization: `Bearer ${user.accessToken}` };
}

async function main() {
  const ip = randomTestIp();
  const p = () => `+91900030${Math.floor(Math.random() * 9000 + 1000)}`;
  const alice = await signUp(p(), ip);
  const bob = await signUp(p(), ip);
  const carol = await signUp(p(), ip);

  console.log("\nFriends — permanent per-user code, instant mutual add");
  {
    const code1 = await j("/friends/code", { headers: auth(alice) });
    check("alice gets a friend code", code1.status === 200 && typeof code1.body.code === "string", JSON.stringify(code1.body));
    const code2 = await j("/friends/code", { headers: auth(alice) });
    check("the code is stable across requests", code2.body.code === code1.body.code, JSON.stringify(code2.body));

    const bobCode = (await j("/friends/code", { headers: auth(bob) })).body.code;
    const add = await j("/friends/add", { method: "POST", headers: auth(alice), body: JSON.stringify({ code: bobCode }) });
    check("alice adds bob by his code", add.status === 201, JSON.stringify(add.body));

    const aliceFriends = await j("/friends", { headers: auth(alice) });
    check("bob shows up in alice's friend list", aliceFriends.body.friends.some((f) => f.id === bob.user.id), JSON.stringify(aliceFriends.body));
    const bobFriends = await j("/friends", { headers: auth(bob) });
    check("the add is mutual — alice shows up in bob's list too", bobFriends.body.friends.some((f) => f.id === alice.user.id), JSON.stringify(bobFriends.body));

    const selfAdd = await j("/friends/add", { method: "POST", headers: auth(alice), body: JSON.stringify({ code: code1.body.code }) });
    check("can't add your own code", selfAdd.status === 400, JSON.stringify(selfAdd.body));

    const badAdd = await j("/friends/add", { method: "POST", headers: auth(alice), body: JSON.stringify({ code: "ZZZZZZZ" }) });
    check("an unknown code is rejected cleanly", badAdd.status === 404, JSON.stringify(badAdd.body));
  }

  console.log("\nFood Circles — built from real friends, real match score");
  let circleId;
  {
    const carolCode = (await j("/friends/code", { headers: auth(carol) })).body.code;
    await j("/friends/add", { method: "POST", headers: auth(alice), body: JSON.stringify({ code: carolCode }) });

    const notAFriendId = "not-a-real-friend-id";
    const create = await j("/circles", {
      method: "POST",
      headers: auth(alice),
      body: JSON.stringify({ name: "Test Circle", memberIds: [bob.user.id, carol.user.id, notAFriendId] }),
    });
    check("alice creates a circle with her real friends", create.status === 201, JSON.stringify(create.body));
    circleId = create.body.circle?.id;

    const list = await j("/circles", { headers: auth(alice) });
    const mine = list.body.circles.find((c) => c.id === circleId);
    check("the circle appears in alice's list with a member count", mine?.memberCount === 3, JSON.stringify(mine));
    check("a non-friend id passed at creation was silently dropped, not added", mine?.memberCount !== 4, JSON.stringify(mine));
    check("match score is a real number, not undefined", typeof mine?.matchScore === "number", JSON.stringify(mine));

    const bobList = await j("/circles", { headers: auth(bob) });
    check("bob (a real member) sees the circle too", bobList.body.circles.some((c) => c.id === circleId), JSON.stringify(bobList.body));

    const detail = await j(`/circles/${circleId}`, { headers: auth(carol) });
    check("carol (a member) can fetch circle detail", detail.status === 200 && detail.body.members.length === 3, JSON.stringify(detail.body));

    const dave = await signUp(p(), ip);
    const outsider = await j(`/circles/${circleId}`, { headers: auth(dave) });
    check("a non-member is denied circle detail", outsider.status === 404, JSON.stringify(outsider.body));
  }

  console.log("\nCraving Rooms — shared candidate list, real overlap on reveal");
  {
    const candidateIds = ["room-dish-a", "room-dish-b", "room-dish-c"];
    const create = await j("/rooms", {
      method: "POST",
      headers: auth(alice),
      body: JSON.stringify({ mood: "Quick bite", radiusKm: 3, candidateIds }),
    });
    check("alice creates a room and gets a short code", create.status === 201 && create.body.room.code?.length >= 4, JSON.stringify(create.body));
    const roomId = create.body.room.id;
    const code = create.body.room.code;

    const join = await j("/rooms/join", { method: "POST", headers: auth(bob), body: JSON.stringify({ code }) });
    check("bob joins with the real room code", join.status === 200 && join.body.room.id === roomId, JSON.stringify(join.body));

    const badJoin = await j("/rooms/join", { method: "POST", headers: auth(carol), body: JSON.stringify({ code: "ZZZZ" }) });
    check("an unknown room code is rejected", badJoin.status === 404, JSON.stringify(badJoin.body));

    // alice likes A and B, bob likes A and C — only A should be unanimous
    await j(`/rooms/${roomId}/swipe`, { method: "POST", headers: auth(alice), body: JSON.stringify({ dishId: "room-dish-a", liked: true }) });
    await j(`/rooms/${roomId}/swipe`, { method: "POST", headers: auth(alice), body: JSON.stringify({ dishId: "room-dish-b", liked: true }) });
    await j(`/rooms/${roomId}/swipe`, { method: "POST", headers: auth(alice), body: JSON.stringify({ dishId: "room-dish-c", liked: false }) });

    const midReveal = await j(`/rooms/${roomId}/reveal`, { headers: auth(alice) });
    check("reveal isn't ready until everyone's swiped", midReveal.body.ready === false, JSON.stringify(midReveal.body));

    await j(`/rooms/${roomId}/swipe`, { method: "POST", headers: auth(bob), body: JSON.stringify({ dishId: "room-dish-a", liked: true }) });
    await j(`/rooms/${roomId}/swipe`, { method: "POST", headers: auth(bob), body: JSON.stringify({ dishId: "room-dish-b", liked: false }) });
    const badDish = await j(`/rooms/${roomId}/swipe`, { method: "POST", headers: auth(bob), body: JSON.stringify({ dishId: "not-a-candidate", liked: true }) });
    check("swiping a dish outside the room's candidate list is rejected", badDish.status === 400, JSON.stringify(badDish.body));
    await j(`/rooms/${roomId}/swipe`, { method: "POST", headers: auth(bob), body: JSON.stringify({ dishId: "room-dish-c", liked: true }) });

    const reveal = await j(`/rooms/${roomId}/reveal`, { headers: auth(alice) });
    check("reveal is ready once both participants finished", reveal.body.ready === true, JSON.stringify(reveal.body));
    check("dish A is the real unanimous pick (both liked it)", reveal.body.unanimous?.includes("room-dish-a"), JSON.stringify(reveal.body));
    check("dish B and C are NOT unanimous (only one person liked each)", !reveal.body.unanimous?.includes("room-dish-b") && !reveal.body.unanimous?.includes("room-dish-c"), JSON.stringify(reveal.body));
    check("B and C show up as partial matches instead", reveal.body.partial?.includes("room-dish-b") && reveal.body.partial?.includes("room-dish-c"), JSON.stringify(reveal.body));

    const outsiderReveal = await j(`/rooms/${roomId}/reveal`, { headers: auth(carol) });
    check("a non-participant can't read the reveal", outsiderReveal.status === 403, JSON.stringify(outsiderReveal.body));
  }

  console.log("\nLists — real creation, real clone lineage and count");
  {
    const create = await j("/lists", {
      method: "POST",
      headers: auth(alice),
      body: JSON.stringify({ title: "Phase 4 test list", items: [{ dishName: "Test Dosa", venue: "Test Cafe" }] }),
    });
    check("alice creates a real list", create.status === 201, JSON.stringify(create.body));
    const listId = create.body.list.id;

    const feed = await j("/lists", { headers: auth(bob) });
    const mine = feed.body.lists.find((l) => l.id === listId);
    check("the list appears in the shared feed with its real item", mine?.items?.[0]?.dishName === "Test Dosa", JSON.stringify(mine));
    check("a fresh list starts with 0 real clones", mine?.clones === 0, JSON.stringify(mine));

    const clone = await j(`/lists/${listId}/clone`, { method: "POST", headers: auth(bob), body: JSON.stringify({}) });
    check("bob clones alice's list", clone.status === 201, JSON.stringify(clone.body));
    check("the clone carries over the real items", clone.body.items?.[0]?.dishName === "Test Dosa", JSON.stringify(clone.body));

    const after = await j(`/lists/${listId}`, { headers: auth(alice) });
    check("the original's clone count is now a real 1, not a placeholder", after.body.clones === 1, JSON.stringify(after.body));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
