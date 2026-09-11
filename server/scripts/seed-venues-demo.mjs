// Seeds a few realistic Bhookmark-community reviews (our own app's data model —
// not scraped from Google/Zomato) so the /venues/nearby feature has real
// content to render instead of empty states. Run with the backend up:
// node scripts/seed-venues-demo.mjs

const BASE = "http://localhost:4001";

async function j(path, opts = {}) {
  const res = await fetch(BASE + path, { ...opts, headers: { "Content-Type": "application/json", ...(opts.headers ?? {}) } });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function loginUser(phone) {
  const otp = (await j("/auth/otp/request", { method: "POST", body: JSON.stringify({ phone }) })).body.devOtp;
  const verify = await j("/auth/otp/verify", { method: "POST", body: JSON.stringify({ phone, otp, deviceLabel: "seed" }) });
  return verify.body;
}

const REVIEWS = [
  { phone: "+919800000001", category: "Burger", subtype: "Chicken", name: "Peri Peri Chicken Burger", venue: "Truffles", verdict: "loved", score: 8.6, note: "The patty stays juicy even after the 20-min wait on a Friday night — worth the queue." },
  { phone: "+919800000002", category: "Burger", subtype: "Chicken", name: "Peri Peri Chicken Burger", venue: "Truffles", verdict: "fine", score: 7.8, note: "Solid burger, but the fries were cold by the time it reached the table outside." },
  { phone: "+919800000003", category: "Burger", subtype: "Chicken", name: "Smoked Chicken Burger", venue: "Toit Brewpub", verdict: "loved", score: 8.3, note: "Pairs well with their house lager — smoky flavor actually comes through." },
  { phone: "+919800000004", category: "Burger", subtype: "Veg", name: "Classic Veg Burger", venue: "Koshy's", verdict: "fine", score: 7.2, note: "More nostalgia than flavor these days, but the old-Bangalore setting makes up for it." },
  { phone: "+919800000005", category: "Burger", subtype: "Veg", name: "Farmer's Veg Burger", venue: "Airlines Hotel", verdict: "loved", score: 7.9, note: "Garden seating makes this one of the few veg burgers worth ordering twice." },
  { phone: "+919800000006", category: "Dosa & Idli", subtype: "Benne Dosa", name: "Benne Masala Dosa", venue: "CTR (Shri Sagar)", verdict: "loved", score: 9.2, note: "Went at 7am on a weekday — no queue, and the butter-to-crisp ratio was perfect." },
  { phone: "+919800000007", category: "Coffee", subtype: "Strong / Degree", name: "Degree Coffee", venue: "Vidyarthi Bhavan", verdict: "loved", score: 9.0, note: "Still served in the steel davara-tumbler set the way it should be." },
];

async function main() {
  for (const r of REVIEWS) {
    const user = await loginUser(r.phone);
    if (!user.accessToken) {
      console.log(`skip ${r.phone}: login failed`, user);
      continue;
    }
    const res = await j("/logs", {
      method: "POST",
      headers: { Authorization: `Bearer ${user.accessToken}`, "Idempotency-Key": `seed-${r.venue}-${r.phone}` },
      body: JSON.stringify({
        category: r.category, subtype: r.subtype, name: r.name, venue: r.venue,
        verdict: r.verdict, score: r.score, note: r.note, deviceId: "seed-device",
        evidence: { livePhoto: true, liveLocationMatch: true, receipt: false },
      }),
    });
    console.log(`${r.venue.padEnd(20)} -> ${res.body?.log?.status ?? res.status}`);
  }
}

main();
