// Real test of the push-notification pipeline's server side (subscribe,
// simulate, unsubscribe). Can't test actual browser delivery from Node, but
// this exercises every line of server logic a real subscribe/push call hits.
const BASE = "http://localhost:4001";
let pass = 0, fail = 0;
function check(name, cond, detail = "") {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}  ${detail}`); }
}
async function j(path, opts = {}) {
  const res = await fetch(BASE + path, { ...opts, headers: { "Content-Type": "application/json", ...(opts.headers ?? {}) } });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function main() {
  const phone = "+919777788899";
  const otp = (await j("/auth/otp/request", { method: "POST", body: JSON.stringify({ phone }) })).body.devOtp;
  const auth = (await j("/auth/otp/verify", { method: "POST", body: JSON.stringify({ phone, otp, deviceLabel: "notif-test" } ) })).body;
  const H = { Authorization: `Bearer ${auth.accessToken}` };

  console.log("\nVAPID public key is exposed for the frontend to subscribe with");
  const vapid = await j("/notifications/vapid-public-key");
  check("returns a public key string", vapid.body.ok && typeof vapid.body.key === "string" && vapid.body.key.length > 20);

  console.log("\nSimulating before any subscription exists fails cleanly, not a crash");
  const beforeSub = await j("/notifications/simulate-friend-nearby", { method: "POST", headers: H, body: JSON.stringify({}) });
  check("400 with a clear error when there's no subscription", beforeSub.status === 400, JSON.stringify(beforeSub.body));

  console.log("\nSubscribing with a fake (but well-formed) push subscription");
  const fakeSub = {
    endpoint: "https://fcm.googleapis.com/fcm/send/fake-endpoint-for-testing",
    keys: { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I3OJEt0zJqWzk", auth: "tBHItJI5svbpez7KI4CCXg" },
  };
  const sub = await j("/notifications/subscribe", { method: "POST", headers: H, body: JSON.stringify(fakeSub) });
  check("subscribe accepts a well-formed subscription", sub.body.ok === true, JSON.stringify(sub.body));

  console.log("\nSubscribing the same endpoint twice doesn't duplicate it");
  await j("/notifications/subscribe", { method: "POST", headers: H, body: JSON.stringify(fakeSub) });
  const subAgain = await j("/notifications/subscribe", { method: "POST", headers: H, body: JSON.stringify(fakeSub) });
  check("subscription count stays at 1 after resubscribing the same endpoint", subAgain.body.subscribed === 1, JSON.stringify(subAgain.body));

  console.log("\nMalformed subscription payloads are rejected");
  const bad = await j("/notifications/subscribe", { method: "POST", headers: H, body: JSON.stringify({ endpoint: "not-a-url" }) });
  check("400 on invalid subscription shape", bad.status === 400, `got ${bad.status}`);

  console.log("\nUnsubscribing clears it, so simulating again fails cleanly");
  await j("/notifications/unsubscribe", { method: "POST", headers: H });
  const afterUnsub = await j("/notifications/simulate-friend-nearby", { method: "POST", headers: H, body: JSON.stringify({}) });
  check("simulate fails again after unsubscribe", afterUnsub.status === 400, JSON.stringify(afterUnsub.body));

  console.log("\nUnauthenticated requests are denied");
  const noAuth = await j("/notifications/subscribe", { method: "POST", body: JSON.stringify(fakeSub) });
  check("401 without a session", noAuth.status === 401, `got ${noAuth.status}`);

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail > 0 ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
