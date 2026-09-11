// Real persistent data layer (Neon Postgres) — replaces the in-memory Maps
// this started as. That version worked for local dev but silently lost all
// data on every restart and couldn't share state across serverless
// invocations; this is the actual production data layer.
import { neon } from "@neondatabase/serverless";
import { nanoid } from "nanoid";

function sql() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");
  return neon(url);
}

export type Role = "user" | "restaurant_owner" | "moderator" | "trust_analyst" | "admin";
// "live-capture"/"transaction-supported" are retained only so historical
// rows (written before F05's fix, 2026-09-08) still read back correctly —
// no code path assigns them to a new log anymore, since neither was ever
// server-verifiable. See routes/logs.ts's evidenceLevel().
export type EvidenceLevel = "declared" | "live-capture" | "visit-consistent" | "transaction-supported" | "location-consistent";
export type LogStatus = "published" | "held" | "removed";
export type DietaryProfile = "no-restriction" | "vegetarian" | "vegan" | "jain" | "eggetarian";

export interface User {
  id: string;
  phone: string | null;
  role: Role;
  dietaryProfile: DietaryProfile;
  allergens: string[];
  createdAt: number;
  friendCode: string | null;
  googleSub: string | null;
  email: string | null;
}

export interface Device {
  id: string;
  userId: string;
  familyId: string;
  createdAt: number;
  lastSeenAt: number;
  label: string;
  ip: string | null;
}

export interface RefreshFamily {
  familyId: string;
  userId: string;
  deviceId: string;
  currentJti: string;
  revoked: boolean;
}

export interface OtpRecord {
  code: string;
  expiresAt: number;
  attempts: number;
}

export type LogVisibility = "private" | "public";

export interface DishLog {
  id: string;
  userId: string;
  category: string;
  subtype: string;
  name: string;
  venue: string;
  verdict: "loved" | "fine" | "not-for-me";
  score: number;
  note: string;
  evidenceLevel: EvidenceLevel;
  verified: boolean;
  status: LogStatus;
  deviceId: string;
  createdAt: number;
  locationVerified: boolean;
  ownerDisclosed: boolean;
  visibility: LogVisibility;
}

export type VenueClaimStatus = "pending" | "approved" | "rejected";

export interface VenueClaim {
  id: string;
  userId: string;
  venue: string;
  status: VenueClaimStatus;
  createdAt: number;
  reviewedAt: number | null;
}

export interface PushSubscriptionJSON {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

function userFromRow(r: any): User {
  return {
    id: r.id,
    phone: r.phone ?? null,
    role: r.role,
    dietaryProfile: r.dietary_profile,
    allergens: r.allergens ?? [],
    createdAt: Number(r.created_at),
    friendCode: r.friend_code ?? null,
    googleSub: r.google_sub ?? null,
    email: r.email ?? null,
  };
}

function deviceFromRow(r: any): Device {
  return { id: r.id, userId: r.user_id, familyId: r.family_id, createdAt: Number(r.created_at), lastSeenAt: Number(r.last_seen_at), label: r.label, ip: r.ip ?? null };
}

function familyFromRow(r: any): RefreshFamily {
  return { familyId: r.family_id, userId: r.user_id, deviceId: r.device_id, currentJti: r.current_jti, revoked: r.revoked };
}

function logFromRow(r: any): DishLog {
  return {
    id: r.id,
    userId: r.user_id,
    category: r.category,
    subtype: r.subtype,
    name: r.name,
    venue: r.venue,
    verdict: r.verdict,
    score: Number(r.score),
    note: r.note ?? "",
    evidenceLevel: r.evidence_level,
    verified: r.verified,
    status: r.status,
    deviceId: r.device_id,
    createdAt: Number(r.created_at),
    locationVerified: r.location_verified ?? false,
    ownerDisclosed: r.owner_disclosed ?? false,
    visibility: r.visibility ?? "public",
  };
}

// ---------- Users ----------

export async function findOrCreateUser(phone: string, newId: string): Promise<User> {
  const db = sql();
  const existing = await db`SELECT * FROM users WHERE phone = ${phone}`;
  if (existing.length) return userFromRow(existing[0]);
  const now = Date.now();
  const rows = await db`
    INSERT INTO users (id, phone, role, dietary_profile, allergens, created_at)
    VALUES (${newId}, ${phone}, 'user', 'no-restriction', '{}', ${now})
    RETURNING *`;
  return userFromRow(rows[0]);
}

// Keyed by Google's stable per-account subject id, not the email (an email
// can move between accounts on Google's side; the sub never does).
export async function findOrCreateUserByGoogle(googleSub: string, email: string, newId: string): Promise<User> {
  const db = sql();
  const existing = await db`SELECT * FROM users WHERE google_sub = ${googleSub}`;
  if (existing.length) return userFromRow(existing[0]);
  const now = Date.now();
  const rows = await db`
    INSERT INTO users (id, phone, role, dietary_profile, allergens, created_at, google_sub, email)
    VALUES (${newId}, NULL, 'user', 'no-restriction', '{}', ${now}, ${googleSub}, ${email})
    RETURNING *`;
  return userFromRow(rows[0]);
}

export async function getUserById(id: string): Promise<User | undefined> {
  const rows = await sql()`SELECT * FROM users WHERE id = ${id}`;
  return rows[0] ? userFromRow(rows[0]) : undefined;
}

export async function setUserRole(id: string, role: Role): Promise<void> {
  await sql()`UPDATE users SET role = ${role} WHERE id = ${id}`;
}

export async function setUserDiet(id: string, dietaryProfile: DietaryProfile, allergens: string[]): Promise<void> {
  await sql()`UPDATE users SET dietary_profile = ${dietaryProfile}, allergens = ${allergens} WHERE id = ${id}`;
}

// ---------- OTP ----------

export async function setOtp(phone: string, record: OtpRecord): Promise<void> {
  await sql()`
    INSERT INTO otps (phone, code, expires_at, attempts) VALUES (${phone}, ${record.code}, ${record.expiresAt}, ${record.attempts})
    ON CONFLICT (phone) DO UPDATE SET code = ${record.code}, expires_at = ${record.expiresAt}, attempts = ${record.attempts}`;
}

export async function getOtp(phone: string): Promise<OtpRecord | undefined> {
  const rows = await sql()`SELECT * FROM otps WHERE phone = ${phone}`;
  return rows[0] ? { code: rows[0].code, expiresAt: Number(rows[0].expires_at), attempts: rows[0].attempts } : undefined;
}

export async function incrementOtpAttempts(phone: string): Promise<void> {
  await sql()`UPDATE otps SET attempts = attempts + 1 WHERE phone = ${phone}`;
}

export async function deleteOtp(phone: string): Promise<void> {
  await sql()`DELETE FROM otps WHERE phone = ${phone}`;
}

// ---------- Devices & refresh families ----------

export async function createDeviceAndFamily(device: Device, family: RefreshFamily): Promise<void> {
  const db = sql();
  await db`INSERT INTO devices (id, user_id, family_id, label, created_at, last_seen_at, ip) VALUES (${device.id}, ${device.userId}, ${device.familyId}, ${device.label}, ${device.createdAt}, ${device.lastSeenAt}, ${device.ip})`;
  await db`INSERT INTO refresh_families (family_id, user_id, device_id, current_jti, revoked) VALUES (${family.familyId}, ${family.userId}, ${family.deviceId}, ${family.currentJti}, false)`;
}

// Ranking-manipulation control (brief 1.5: "multiple accounts from the same
// device or network"): counts distinct accounts that have logged in from
// one IP recently. A real signal from data already collected at login —
// not a new tracking mechanism — used to hold ranking influence, never to
// auto-block (a shared office/hostel network is expected to have several
// real accounts; this only fires on real distinct-account volume, not on
// request volume from repeat logins of the same account).
export async function countDistinctUsersFromIp(ip: string, windowMs: number): Promise<number> {
  if (!ip) return 0;
  const cutoff = Date.now() - windowMs;
  const rows = await sql()`
    SELECT COUNT(DISTINCT user_id)::int AS n FROM devices WHERE ip = ${ip} AND created_at > ${cutoff}`;
  return (rows[0] as any)?.n ?? 0;
}

export async function getFamily(familyId: string): Promise<RefreshFamily | undefined> {
  const rows = await sql()`SELECT * FROM refresh_families WHERE family_id = ${familyId}`;
  return rows[0] ? familyFromRow(rows[0]) : undefined;
}

export async function revokeFamily(familyId: string): Promise<void> {
  await sql()`UPDATE refresh_families SET revoked = true WHERE family_id = ${familyId}`;
}

export async function rotateFamilyJti(familyId: string, newJti: string): Promise<void> {
  await sql()`UPDATE refresh_families SET current_jti = ${newJti} WHERE family_id = ${familyId}`;
}

export async function getDevice(deviceId: string): Promise<Device | undefined> {
  const rows = await sql()`SELECT * FROM devices WHERE id = ${deviceId}`;
  return rows[0] ? deviceFromRow(rows[0]) : undefined;
}

export async function touchDevice(deviceId: string): Promise<void> {
  await sql()`UPDATE devices SET last_seen_at = ${Date.now()} WHERE id = ${deviceId}`;
}

export async function listDevicesForUser(userId: string): Promise<Device[]> {
  const rows = await sql()`SELECT * FROM devices WHERE user_id = ${userId}`;
  return rows.map(deviceFromRow);
}

// ---------- Logs ----------

export async function createLog(log: DishLog): Promise<void> {
  await sql()`
    INSERT INTO logs (id, user_id, category, subtype, name, venue, verdict, score, note, evidence_level, verified, status, device_id, created_at, location_verified, owner_disclosed, visibility)
    VALUES (${log.id}, ${log.userId}, ${log.category}, ${log.subtype}, ${log.name}, ${log.venue}, ${log.verdict}, ${log.score}, ${log.note}, ${log.evidenceLevel}, ${log.verified}, ${log.status}, ${log.deviceId}, ${log.createdAt}, ${log.locationVerified}, ${log.ownerDisclosed}, ${log.visibility})`;
}

export async function getLogById(id: string): Promise<DishLog | undefined> {
  const rows = await sql()`SELECT * FROM logs WHERE id = ${id}`;
  return rows[0] ? logFromRow(rows[0]) : undefined;
}

export async function deleteLog(id: string): Promise<void> {
  await sql()`DELETE FROM logs WHERE id = ${id}`;
}

// ---------- Ranking-manipulation signals (brief 1.5) ----------

export async function mostRecentLocationVerifiedLog(userId: string, excludeVenue?: string): Promise<DishLog | undefined> {
  const rows = excludeVenue
    ? await sql()`SELECT * FROM logs WHERE user_id = ${userId} AND location_verified = true AND venue <> ${excludeVenue} ORDER BY created_at DESC LIMIT 1`
    : await sql()`SELECT * FROM logs WHERE user_id = ${userId} AND location_verified = true ORDER BY created_at DESC LIMIT 1`;
  return rows[0] ? logFromRow(rows[0]) : undefined;
}

export async function recordLogDeletion(userId: string, venue: string, category: string, subtype: string, name: string): Promise<void> {
  await sql()`
    INSERT INTO log_deletions (user_id, venue, category, subtype, name, deleted_at)
    VALUES (${userId}, ${venue}, ${category}, ${subtype}, ${name}, ${Date.now()})`;
}

export async function countRecentDeletions(userId: string, venue: string, windowMs: number): Promise<number> {
  const cutoff = Date.now() - windowMs;
  const rows = await sql()`
    SELECT COUNT(*)::int AS n FROM log_deletions WHERE user_id = ${userId} AND venue = ${venue} AND deleted_at > ${cutoff}`;
  return (rows[0] as any)?.n ?? 0;
}

export async function listLogsForUser(userId: string): Promise<DishLog[]> {
  const rows = await sql()`SELECT * FROM logs WHERE user_id = ${userId} ORDER BY created_at DESC`;
  return rows.map(logFromRow);
}

// All three public aggregates below exclude owner_disclosed logs (brief
// 1.5: restaurant staff self-rating their own venue must not silently
// influence organic rankings) — an owner's own log still exists and shows
// up on their personal Bhookmarks, it just never counts toward what other
// people see as "the" score.
// All public reads exclude both owner-disclosed logs (above) AND private
// logs (brief Phase 2: granular visibility) — a private log still exists
// for its owner's own journal, it just never enters any aggregate anyone
// else can see.
export async function listPublishedLogs(venue: string, category: string): Promise<DishLog[]> {
  const rows = await sql()`SELECT * FROM logs WHERE venue = ${venue} AND category = ${category} AND status = 'published' AND owner_disclosed = false AND visibility = 'public' ORDER BY created_at DESC`;
  return rows.map(logFromRow);
}

// Batched version of the above for a whole page of venues at once (e.g.
// Near Me's result list). Phase 2 Session D found the real cost of NOT
// having this: /venues/nearby was calling listPublishedLogs once per
// venue inside a Promise.all, which for a common category with 100+
// venues in range fired 100+ simultaneous connections and exhausted a
// Neon branch's connection limit — a real scalability bug, not just a
// small-test-branch quirk. One query, grouped by venue in JS, instead.
export async function listPublishedLogsForVenues(venueNames: string[], category: string): Promise<Map<string, DishLog[]>> {
  const byVenue = new Map<string, DishLog[]>();
  if (venueNames.length === 0) return byVenue;
  const rows = await sql()`
    SELECT * FROM logs
    WHERE venue = ANY(${venueNames}) AND category = ${category} AND status = 'published' AND owner_disclosed = false AND visibility = 'public'
    ORDER BY created_at DESC`;
  for (const row of rows) {
    const log = logFromRow(row);
    const list = byVenue.get(log.venue) ?? [];
    list.push(log);
    byVenue.set(log.venue, list);
  }
  return byVenue;
}

export async function listPublishedLogsByCategorySubtype(category: string, subtype: string): Promise<DishLog[]> {
  const rows = await sql()`SELECT * FROM logs WHERE category = ${category} AND subtype = ${subtype} AND status = 'published' AND owner_disclosed = false AND visibility = 'public'`;
  return rows.map(logFromRow);
}

// Score separation (brief section 1.2): the category+subtype aggregate above
// is city-wide and too coarse to be "this dish's score" — this narrows to
// the exact venue+category+subtype+name a dish profile page actually shows.
export async function listPublishedLogsForDish(venue: string, category: string, subtype: string, name: string): Promise<DishLog[]> {
  const rows = await sql()`
    SELECT * FROM logs
    WHERE venue = ${venue} AND category = ${category} AND subtype = ${subtype} AND name = ${name} AND status = 'published' AND owner_disclosed = false AND visibility = 'public'`;
  return rows.map(logFromRow);
}

export interface TrendingDish {
  venue: string;
  category: string;
  subtype: string;
  name: string;
  count: number;
  distinctUsers: number;
}

// Real "trending" signal (brief 1.6: never use an urgency label like
// "trending" unless it's backed by a defined recent-time-window
// calculation) — a real count of real logs in the trailing window, with a
// minimum-evidence floor on both log count AND distinct users so a single
// account (or a small coordinated burst) can't manufacture a trend. Test
// fixtures created by this project's own QA scripts are excluded by name
// pattern so they can never surface as a fake "trending" claim.
export async function getTrendingDish(windowMs: number, minCount: number, minUsers: number): Promise<TrendingDish | null> {
  const cutoff = Date.now() - windowMs;
  const rows = await sql()`
    SELECT venue, category, subtype, name, COUNT(*)::int AS cnt, COUNT(DISTINCT user_id)::int AS distinct_users
    FROM logs
    WHERE status = 'published'
      AND visibility = 'public'
      AND created_at > ${cutoff}
      AND venue NOT ILIKE 'QA %' AND venue NOT ILIKE '%test%'
      -- 2026-09-10: a real fixture ("QA Travel Dosa", logged against the
      -- real venue "CTR (Shri Sagar)" by server/scripts/qa-brief-tests.mjs's
      -- impossible-travel check) surfaced as the live "trending" pick in
      -- production — the QA-prefix exclusion only ever checked venue, not
      -- the dish name that actually carried the tell here.
      AND name NOT ILIKE '%test%' AND name NOT ILIKE 'ghost%' AND name NOT ILIKE 'QA %'
    GROUP BY venue, category, subtype, name
    HAVING COUNT(*) >= ${minCount} AND COUNT(DISTINCT user_id) >= ${minUsers}
    ORDER BY cnt DESC
    LIMIT 1`;
  if (!rows[0]) return null;
  const r = rows[0] as any;
  return { venue: r.venue, category: r.category, subtype: r.subtype, name: r.name, count: r.cnt, distinctUsers: r.distinct_users };
}

export async function listHeldLogs(): Promise<DishLog[]> {
  const rows = await sql()`SELECT * FROM logs WHERE status = 'held'`;
  return rows.map(logFromRow);
}

export async function setLogStatus(id: string, status: LogStatus): Promise<DishLog | undefined> {
  const rows = await sql()`UPDATE logs SET status = ${status} WHERE id = ${id} RETURNING *`;
  return rows[0] ? logFromRow(rows[0]) : undefined;
}

// ---------- Idempotency ----------

export async function getIdempotent(key: string): Promise<{ status: number; body: unknown } | undefined> {
  const rows = await sql()`SELECT * FROM idempotency_keys WHERE key = ${key}`;
  return rows[0] ? { status: rows[0].status, body: rows[0].body } : undefined;
}

export async function setIdempotent(key: string, status: number, body: unknown): Promise<void> {
  await sql()`
    INSERT INTO idempotency_keys (key, status, body, created_at) VALUES (${key}, ${status}, ${JSON.stringify(body)}, ${Date.now()})
    ON CONFLICT (key) DO NOTHING`;
}

// ---------- Venue velocity (burst detection) ----------

export async function recordVenueHit(key: string, now: number, windowMs: number): Promise<number> {
  const db = sql();
  const rows = await db`SELECT hits FROM venue_velocity WHERE key = ${key}`;
  const existing: number[] = rows[0]?.hits?.map(Number) ?? [];
  const recent = existing.filter((t) => now - t < windowMs);
  recent.push(now);
  await db`
    INSERT INTO venue_velocity (key, hits) VALUES (${key}, ${recent})
    ON CONFLICT (key) DO UPDATE SET hits = ${recent}`;
  return recent.length;
}

// ---------- Security events ----------

export async function logSecurityEvent(type: string, detail: string): Promise<void> {
  await sql()`INSERT INTO security_events (type, detail, at) VALUES (${type}, ${detail}, ${Date.now()})`;
  // eslint-disable-next-line no-console
  console.warn(`[security] ${type}: ${detail}`);
}

export async function listSecurityEvents(limit = 50): Promise<{ type: string; detail: string; at: number }[]> {
  const rows = await sql()`SELECT type, detail, at FROM security_events ORDER BY at DESC LIMIT ${limit}`;
  return rows.map((r: any) => ({ type: r.type, detail: r.detail, at: Number(r.at) }));
}

// ---------- Venue claims (brief 1.5: restaurant self-rating disclosure) ----------

function venueClaimFromRow(r: any): VenueClaim {
  return { id: r.id, userId: r.user_id, venue: r.venue, status: r.status, createdAt: Number(r.created_at), reviewedAt: r.reviewed_at ? Number(r.reviewed_at) : null };
}

export async function createVenueClaim(claim: { id: string; userId: string; venue: string; createdAt: number }): Promise<void> {
  await sql()`
    INSERT INTO venue_claims (id, user_id, venue, status, created_at)
    VALUES (${claim.id}, ${claim.userId}, ${claim.venue}, 'pending', ${claim.createdAt})`;
}

export async function listVenueClaims(status?: VenueClaimStatus): Promise<VenueClaim[]> {
  const rows = status
    ? await sql()`SELECT * FROM venue_claims WHERE status = ${status} ORDER BY created_at DESC`
    : await sql()`SELECT * FROM venue_claims ORDER BY created_at DESC`;
  return rows.map(venueClaimFromRow);
}

export async function getVenueClaimById(id: string): Promise<VenueClaim | undefined> {
  const rows = await sql()`SELECT * FROM venue_claims WHERE id = ${id}`;
  return rows[0] ? venueClaimFromRow(rows[0]) : undefined;
}

export async function setVenueClaimStatus(id: string, status: "approved" | "rejected"): Promise<VenueClaim | undefined> {
  const rows = await sql()`UPDATE venue_claims SET status = ${status}, reviewed_at = ${Date.now()} WHERE id = ${id} RETURNING *`;
  return rows[0] ? venueClaimFromRow(rows[0]) : undefined;
}

// The actual check used at log-creation time — a user is a disclosed owner
// of a venue only once a moderator has approved the claim, never on the
// strength of a pending self-submission alone.
export async function isApprovedOwnerOfVenue(userId: string, venue: string): Promise<boolean> {
  const rows = await sql()`
    SELECT 1 FROM venue_claims WHERE user_id = ${userId} AND venue = ${venue} AND status = 'approved' LIMIT 1`;
  return rows.length > 0;
}

export async function listApprovedVenuesForUser(userId: string): Promise<string[]> {
  const rows = await sql()`SELECT venue FROM venue_claims WHERE user_id = ${userId} AND status = 'approved'`;
  return rows.map((r: any) => r.venue);
}

// ---------- Push subscriptions ----------

export async function addPushSubscription(userId: string, sub: PushSubscriptionJSON): Promise<number> {
  await sql()`
    INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (${userId}, ${sub.endpoint}, ${sub.keys.p256dh}, ${sub.keys.auth})
    ON CONFLICT (user_id, endpoint) DO NOTHING`;
  const rows = await sql()`SELECT COUNT(*)::int AS n FROM push_subscriptions WHERE user_id = ${userId}`;
  return rows[0].n;
}

export async function getPushSubscriptions(userId: string): Promise<PushSubscriptionJSON[]> {
  const rows = await sql()`SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ${userId}`;
  return rows.map((r: any) => ({ endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } }));
}

export async function replacePushSubscriptions(userId: string, subs: PushSubscriptionJSON[]): Promise<void> {
  const db = sql();
  await db`DELETE FROM push_subscriptions WHERE user_id = ${userId}`;
  for (const sub of subs) {
    await db`INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (${userId}, ${sub.endpoint}, ${sub.keys.p256dh}, ${sub.keys.auth})`;
  }
}

export async function deleteAllPushSubscriptions(userId: string): Promise<void> {
  await sql()`DELETE FROM push_subscriptions WHERE user_id = ${userId}`;
}

// ---------- Phase 4: Friends, Circles, Craving Rooms, Lists ----------
// Real backend for what was previously 100% hardcoded mock data in the
// frontend (FoodCircles.tsx's 3 fake circles, CravingRoom.tsx's fake
// friends, RemixableLists.tsx's 3 seed lists).

// F02 (implementation brief, 2026-09-08): this used to include the real
// phone number — "PublicUser" in name only. Nothing here should ever be
// sensitive: it's exactly what a friend, circle member or room
// participant is allowed to see about someone else.
export interface PublicUser {
  id: string;
  createdAt: number;
}

function publicUserFromRow(r: any): PublicUser {
  return { id: r.id, createdAt: Number(r.created_at) };
}

// Unambiguous alphabet — no 0/O, 1/I/L — so a code is easy to read aloud or
// type in, matching the "friend code" ask (a real permanent per-user code,
// not a one-off room code).
const FRIEND_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
function randomFriendCode(): string {
  let out = "";
  for (let i = 0; i < 7; i++) out += FRIEND_CODE_ALPHABET[Math.floor(Math.random() * FRIEND_CODE_ALPHABET.length)];
  return out;
}

// Lazily backfilled on first request rather than in the schema migration —
// a bulk ALTER can't assign a distinct random value per existing row in one
// statement. Retries on the (very unlikely) unique-constraint collision.
export async function getOrCreateFriendCode(userId: string): Promise<string> {
  const existing = await sql()`SELECT friend_code FROM users WHERE id = ${userId}`;
  if (existing[0]?.friend_code) return existing[0].friend_code;
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomFriendCode();
    try {
      await sql()`UPDATE users SET friend_code = ${code} WHERE id = ${userId} AND friend_code IS NULL`;
      const check = await sql()`SELECT friend_code FROM users WHERE id = ${userId}`;
      if (check[0]?.friend_code) return check[0].friend_code;
    } catch {
      // unique collision — retry with a new code
    }
  }
  throw new Error("Could not allocate a friend code.");
}

export async function findUserByFriendCode(code: string): Promise<User | undefined> {
  const rows = await sql()`SELECT * FROM users WHERE friend_code = ${code.toUpperCase()}`;
  return rows[0] ? userFromRow(rows[0]) : undefined;
}

// Instant and mutual — no pending-request step, matching "just like adding
// a friend in a game." Both directions inserted so a lookup is a plain
// WHERE user_id = X, never an OR across two columns.
export async function addFriendship(userId: string, friendId: string): Promise<void> {
  const db = sql();
  const now = Date.now();
  await db`INSERT INTO friendships (user_id, friend_id, created_at) VALUES (${userId}, ${friendId}, ${now}) ON CONFLICT DO NOTHING`;
  await db`INSERT INTO friendships (user_id, friend_id, created_at) VALUES (${friendId}, ${userId}, ${now}) ON CONFLICT DO NOTHING`;
}

export async function areFriends(userId: string, otherId: string): Promise<boolean> {
  const rows = await sql()`SELECT 1 FROM friendships WHERE user_id = ${userId} AND friend_id = ${otherId} LIMIT 1`;
  return rows.length > 0;
}

export async function listFriends(userId: string): Promise<PublicUser[]> {
  const rows = await sql()`
    SELECT u.* FROM friendships f JOIN users u ON u.id = f.friend_id
    WHERE f.user_id = ${userId} ORDER BY f.created_at DESC`;
  return rows.map(publicUserFromRow);
}

// ---------- Friend requests (F02) ----------

export type FriendRequestStatus = "pending" | "accepted" | "declined";

export interface FriendRequest {
  id: string;
  senderId: string;
  recipientId: string;
  status: FriendRequestStatus;
  createdAt: number;
  respondedAt: number | null;
}

function friendRequestFromRow(r: any): FriendRequest {
  return {
    id: r.id,
    senderId: r.sender_id,
    recipientId: r.recipient_id,
    status: r.status,
    createdAt: Number(r.created_at),
    respondedAt: r.responded_at ? Number(r.responded_at) : null,
  };
}

// The partial unique index on (LEAST, GREATEST) of the two ids means a
// second pending request between the same pair fails at the DB level —
// this just turns that into a clean "already pending" result instead of
// a raw constraint-violation error.
export async function createFriendRequest(senderId: string, recipientId: string): Promise<FriendRequest | { alreadyPending: true }> {
  try {
    const rows = await sql()`
      INSERT INTO friend_requests (id, sender_id, recipient_id, status, created_at)
      VALUES (${nanoid()}, ${senderId}, ${recipientId}, 'pending', ${Date.now()})
      RETURNING *`;
    return friendRequestFromRow(rows[0]);
  } catch {
    return { alreadyPending: true };
  }
}

// The one already-pending request between these two people, regardless of
// who sent it — used to detect "they already asked me" so entering a
// code when the other side already requested you accepts immediately
// instead of creating a second, redundant request.
export async function getPendingRequestBetween(a: string, b: string): Promise<FriendRequest | undefined> {
  const rows = await sql()`
    SELECT * FROM friend_requests
    WHERE status = 'pending' AND ((sender_id = ${a} AND recipient_id = ${b}) OR (sender_id = ${b} AND recipient_id = ${a}))
    LIMIT 1`;
  return rows[0] ? friendRequestFromRow(rows[0]) : undefined;
}

export async function listIncomingFriendRequests(userId: string): Promise<FriendRequest[]> {
  const rows = await sql()`SELECT * FROM friend_requests WHERE recipient_id = ${userId} AND status = 'pending' ORDER BY created_at DESC`;
  return rows.map(friendRequestFromRow);
}

export async function getFriendRequestById(id: string): Promise<FriendRequest | undefined> {
  const rows = await sql()`SELECT * FROM friend_requests WHERE id = ${id}`;
  return rows[0] ? friendRequestFromRow(rows[0]) : undefined;
}

// Recipient-only, and only while still pending — guards against a stale
// double-tap or a replayed request id trying to accept twice.
export async function respondToFriendRequest(id: string, recipientId: string, accept: boolean): Promise<FriendRequest | undefined> {
  const status = accept ? "accepted" : "declined";
  const rows = await sql()`
    UPDATE friend_requests SET status = ${status}, responded_at = ${Date.now()}
    WHERE id = ${id} AND recipient_id = ${recipientId} AND status = 'pending'
    RETURNING *`;
  if (!rows[0]) return undefined;
  const request = friendRequestFromRow(rows[0]);
  if (accept) await addFriendship(request.senderId, request.recipientId);
  return request;
}

// ---------- Food Circles ----------

export interface Circle {
  id: string;
  name: string;
  creatorId: string;
  createdAt: number;
}

function circleFromRow(r: any): Circle {
  return { id: r.id, name: r.name, creatorId: r.creator_id, createdAt: Number(r.created_at) };
}

export async function createCircle(id: string, name: string, creatorId: string, memberIds: string[]): Promise<Circle> {
  const db = sql();
  const now = Date.now();
  const rows = await db`INSERT INTO circles (id, name, creator_id, created_at) VALUES (${id}, ${name}, ${creatorId}, ${now}) RETURNING *`;
  const allMembers = [...new Set([creatorId, ...memberIds])];
  for (const uid of allMembers) {
    await db`INSERT INTO circle_members (circle_id, user_id, joined_at) VALUES (${id}, ${uid}, ${now}) ON CONFLICT DO NOTHING`;
  }
  return circleFromRow(rows[0]);
}

export async function listCirclesForUser(userId: string): Promise<Circle[]> {
  const rows = await sql()`
    SELECT c.* FROM circle_members cm JOIN circles c ON c.id = cm.circle_id
    WHERE cm.user_id = ${userId} ORDER BY c.created_at DESC`;
  return rows.map(circleFromRow);
}

export async function listCircleMembers(circleId: string): Promise<PublicUser[]> {
  const rows = await sql()`
    SELECT u.* FROM circle_members cm JOIN users u ON u.id = cm.user_id
    WHERE cm.circle_id = ${circleId}`;
  return rows.map(publicUserFromRow);
}

export async function isCircleMember(circleId: string, userId: string): Promise<boolean> {
  const rows = await sql()`SELECT 1 FROM circle_members WHERE circle_id = ${circleId} AND user_id = ${userId} LIMIT 1`;
  return rows.length > 0;
}

// Real match score: the fraction of the circle's combined loved categories
// that every single member has in common (Jaccard-style intersection over
// union) — derived from each member's actual published logs, never a
// placeholder number like the old hardcoded 78%/91%/64%.
export async function computeCircleMatchScore(memberIds: string[]): Promise<number> {
  if (memberIds.length < 2) return 0;
  const perMember: Set<string>[] = [];
  for (const uid of memberIds) {
    // F06 (implementation brief, 2026-09-08): this only excluded removed
    // logs — a private or held log still contributed to another member's
    // match score. Matches the same eligibility filter already used for
    // every *public* aggregate elsewhere (dish scores, trending): only
    // published, publicly-visible, non-self-promotional logs count.
    const rows = await sql()`
      SELECT DISTINCT category FROM logs
      WHERE user_id = ${uid} AND verdict = 'loved' AND status = 'published' AND visibility = 'public' AND owner_disclosed = false`;
    perMember.push(new Set(rows.map((r: any) => r.category)));
  }
  const union = new Set<string>();
  perMember.forEach((s) => s.forEach((c) => union.add(c)));
  if (union.size === 0) return 0;
  let intersectionCount = 0;
  union.forEach((cat) => {
    if (perMember.every((s) => s.has(cat))) intersectionCount++;
  });
  return Math.round((intersectionCount / union.size) * 100);
}

// ---------- Craving Rooms ----------

export type RoomStatus = "setup" | "swiping" | "revealed";

export interface CravingRoom {
  id: string;
  code: string;
  creatorId: string;
  mood: string;
  radiusKm: number;
  status: RoomStatus;
  candidateIds: string[];
  createdAt: number;
  expiresAt: number;
}

function roomFromRow(r: any): CravingRoom {
  return {
    id: r.id,
    code: r.code,
    creatorId: r.creator_id,
    mood: r.mood,
    radiusKm: r.radius_km,
    status: r.status,
    candidateIds: r.candidate_ids ?? [],
    createdAt: Number(r.created_at),
    expiresAt: Number(r.expires_at),
  };
}

const ROOM_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
function randomRoomCode(): string {
  let out = "";
  for (let i = 0; i < 5; i++) out += ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)];
  return out;
}

// candidateIds is fixed by the creator at room creation — every participant
// swipes on this exact same list (fetched, never independently recomputed)
// so "everyone agreed on X" is actually true, not a coincidence of two
// clients happening to pick the same default slice.
export async function createCravingRoom(
  id: string,
  creatorId: string,
  mood: string,
  radiusKm: number,
  candidateIds: string[],
  ttlMs: number
): Promise<CravingRoom> {
  const db = sql();
  const now = Date.now();
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomRoomCode();
    try {
      const rows = await db`
        INSERT INTO craving_rooms (id, code, creator_id, mood, radius_km, status, candidate_ids, created_at, expires_at)
        VALUES (${id}, ${code}, ${creatorId}, ${mood}, ${radiusKm}, 'setup', ${candidateIds}, ${now}, ${now + ttlMs})
        RETURNING *`;
      await db`INSERT INTO craving_room_participants (room_id, user_id, joined_at) VALUES (${id}, ${creatorId}, ${now})`;
      return roomFromRow(rows[0]);
    } catch {
      // code collision — retry
    }
  }
  throw new Error("Could not allocate a room code.");
}

export async function getRoomByCode(code: string): Promise<CravingRoom | undefined> {
  const rows = await sql()`SELECT * FROM craving_rooms WHERE code = ${code.toUpperCase()} AND expires_at > ${Date.now()}`;
  return rows[0] ? roomFromRow(rows[0]) : undefined;
}

export async function getRoomById(id: string): Promise<CravingRoom | undefined> {
  const rows = await sql()`SELECT * FROM craving_rooms WHERE id = ${id}`;
  return rows[0] ? roomFromRow(rows[0]) : undefined;
}

export async function joinRoom(roomId: string, userId: string): Promise<void> {
  await sql()`INSERT INTO craving_room_participants (room_id, user_id, joined_at) VALUES (${roomId}, ${userId}, ${Date.now()}) ON CONFLICT DO NOTHING`;
}

export async function listRoomParticipants(roomId: string): Promise<PublicUser[]> {
  const rows = await sql()`
    SELECT u.* FROM craving_room_participants p JOIN users u ON u.id = p.user_id
    WHERE p.room_id = ${roomId} ORDER BY p.joined_at ASC`;
  return rows.map(publicUserFromRow);
}

export async function setRoomStatus(roomId: string, status: RoomStatus): Promise<void> {
  await sql()`UPDATE craving_rooms SET status = ${status} WHERE id = ${roomId}`;
}

export async function recordRoomSwipe(roomId: string, userId: string, dishId: string, liked: boolean): Promise<void> {
  await sql()`
    INSERT INTO craving_room_swipes (room_id, user_id, dish_id, liked, created_at) VALUES (${roomId}, ${userId}, ${dishId}, ${liked}, ${Date.now()})
    ON CONFLICT (room_id, user_id, dish_id) DO UPDATE SET liked = ${liked}`;
}

export interface RoomSwipe {
  userId: string;
  dishId: string;
  liked: boolean;
}

export async function listRoomSwipes(roomId: string): Promise<RoomSwipe[]> {
  const rows = await sql()`SELECT user_id, dish_id, liked FROM craving_room_swipes WHERE room_id = ${roomId}`;
  return rows.map((r: any) => ({ userId: r.user_id, dishId: r.dish_id, liked: r.liked }));
}

export async function countUserSwipesInRoom(roomId: string, userId: string): Promise<number> {
  const rows = await sql()`SELECT COUNT(*)::int AS n FROM craving_room_swipes WHERE room_id = ${roomId} AND user_id = ${userId}`;
  return rows[0]?.n ?? 0;
}

// ---------- Lists ----------

export interface ListItem {
  dishName: string;
  venue: string;
}

export interface DishList {
  id: string;
  title: string;
  authorId: string;
  parentListId: string | null;
  createdAt: number;
}

function listFromRow(r: any): DishList {
  return { id: r.id, title: r.title, authorId: r.author_id, parentListId: r.parent_list_id ?? null, createdAt: Number(r.created_at) };
}

export async function createList(id: string, title: string, authorId: string, items: ListItem[], parentListId?: string): Promise<DishList> {
  const db = sql();
  const now = Date.now();
  const rows = await db`
    INSERT INTO lists (id, title, author_id, parent_list_id, created_at) VALUES (${id}, ${title}, ${authorId}, ${parentListId ?? null}, ${now})
    RETURNING *`;
  for (let i = 0; i < items.length; i++) {
    await db`INSERT INTO list_items (list_id, dish_name, venue, position) VALUES (${id}, ${items[i].dishName}, ${items[i].venue}, ${i})`;
  }
  return listFromRow(rows[0]);
}

export async function listListsFeed(limit = 30): Promise<DishList[]> {
  const rows = await sql()`SELECT * FROM lists ORDER BY created_at DESC LIMIT ${limit}`;
  return rows.map(listFromRow);
}

export async function getListById(id: string): Promise<DishList | undefined> {
  const rows = await sql()`SELECT * FROM lists WHERE id = ${id}`;
  return rows[0] ? listFromRow(rows[0]) : undefined;
}

export async function getListItems(listId: string): Promise<ListItem[]> {
  const rows = await sql()`SELECT dish_name, venue FROM list_items WHERE list_id = ${listId} ORDER BY position ASC`;
  return rows.map((r: any) => ({ dishName: r.dish_name, venue: r.venue }));
}

export async function countClones(listId: string): Promise<number> {
  const rows = await sql()`SELECT COUNT(*)::int AS n FROM lists WHERE parent_list_id = ${listId}`;
  return rows[0]?.n ?? 0;
}

// ===== Phase 2: catalog (venues/dishes/aliases) =====

export interface CatalogVenue {
  id: string;
  name: string;
  area: string;
  city: string;
  lat: number;
  lng: number;
  photoUrl: string | null;
  photoIsVerified: boolean;
  source: "seed" | "osm" | "user-submitted";
  osmId: string | null;
  status: "active" | "pending-review" | "rejected" | "merged";
}

function catalogVenueFromRow(r: any): CatalogVenue {
  return {
    id: r.id,
    name: r.name,
    area: r.area,
    city: r.city,
    lat: Number(r.lat),
    lng: Number(r.lng),
    photoUrl: r.photo_url ?? null,
    photoIsVerified: r.photo_is_verified,
    source: r.source,
    osmId: r.osm_id ?? null,
    status: r.status,
  };
}

// Whole alias vocabulary fetched once and cached in memory by the caller
// (the ingestion script processes hundreds of OSM tags; the /venues/nearby
// route resolves one term per request) — a per-lookup round trip isn't
// worth it for a table this small.
export async function getCategoryAliasMap(): Promise<{ aliases: Map<string, string>; canonical: Set<string> }> {
  const rows = await sql()`SELECT alias, category FROM category_aliases`;
  const aliases = new Map<string, string>();
  const canonical = new Set<string>();
  for (const r of rows as any[]) {
    aliases.set(r.alias, r.category);
    canonical.add(r.category);
  }
  return { aliases, canonical };
}

export async function getDishNameAliasMap(): Promise<Map<string, string>> {
  const rows = await sql()`SELECT alias, canonical_token FROM dish_name_aliases`;
  return new Map((rows as any[]).map((r) => [r.alias, r.canonical_token]));
}

export async function insertVenue(v: {
  id: string;
  name: string;
  area: string;
  city: string;
  lat: number;
  lng: number;
  source: string;
  osmId: string | null;
  createdBy: string | null;
  now: number;
}): Promise<CatalogVenue | null> {
  const rows = await sql()`
    INSERT INTO venues (id, name, area, city, lat, lng, source, osm_id, created_by, created_at, updated_at)
    VALUES (${v.id}, ${v.name}, ${v.area}, ${v.city}, ${v.lat}, ${v.lng}, ${v.source}, ${v.osmId}, ${v.createdBy}, ${v.now}, ${v.now})
    ON CONFLICT (osm_id) WHERE osm_id IS NOT NULL DO NOTHING
    RETURNING *`;
  return rows[0] ? catalogVenueFromRow(rows[0]) : null;
}

export async function insertDish(d: {
  id: string;
  venueId: string;
  category: string;
  subtype: string;
  name: string;
  source: string;
  createdBy: string | null;
  now: number;
}): Promise<boolean> {
  const rows = await sql()`
    INSERT INTO dishes (id, venue_id, category, subtype, name, source, created_by, created_at, updated_at)
    VALUES (${d.id}, ${d.venueId}, ${d.category}, ${d.subtype}, ${d.name}, ${d.source}, ${d.createdBy}, ${d.now}, ${d.now})
    ON CONFLICT (venue_id, category, subtype, lower(name)) WHERE status <> 'merged' DO NOTHING
    RETURNING id`;
  return rows.length > 0;
}

export async function countVenuesBySource(): Promise<Record<string, number>> {
  const rows = await sql()`SELECT source, COUNT(*)::int AS n FROM venues GROUP BY source`;
  const out: Record<string, number> = {};
  for (const r of rows as any[]) out[r.source] = r.n;
  return out;
}

export interface NearbyVenueRow {
  id: string;
  name: string;
  area: string;
  lat: number;
  lng: number;
  photoUrl: string | null;
  photoIsVerified: boolean;
  dishSubtype: string;
  dishName: string;
}

// Bounding-box prefilter only (no PostGIS, per the Phase 2 plan's explicit
// scope decision) — the route computes exact haversine distance and does
// the final radius cut in JS, same division of labor the old hardcoded
// VENUES array used. DISTINCT ON (v.id) so a venue with more than one
// dish in the same category (real once seed/user data layers onto OSM
// venues) still surfaces once, not once per dish.
export async function listVenuesNearbyByCategory(
  category: string,
  bbox: { latMin: number; latMax: number; lngMin: number; lngMax: number }
): Promise<NearbyVenueRow[]> {
  const rows = await sql()`
    SELECT DISTINCT ON (v.id) v.id, v.name, v.area, v.lat, v.lng, v.photo_url, v.photo_is_verified, d.subtype AS dish_subtype, d.name AS dish_name
    FROM venues v
    JOIN dishes d ON d.venue_id = v.id
    WHERE d.category = ${category} AND v.status = 'active' AND d.status = 'active'
      AND v.lat BETWEEN ${bbox.latMin} AND ${bbox.latMax}
      AND v.lng BETWEEN ${bbox.lngMin} AND ${bbox.lngMax}
    ORDER BY v.id`;
  return (rows as any[]).map((r) => ({
    id: r.id,
    name: r.name,
    area: r.area,
    lat: Number(r.lat),
    lng: Number(r.lng),
    photoUrl: r.photo_url ?? null,
    photoIsVerified: r.photo_is_verified,
    dishSubtype: r.dish_subtype,
    dishName: r.dish_name,
  }));
}

export interface SearchVenueRow {
  id: string;
  name: string;
  area: string;
  lat: number;
  lng: number;
  photoUrl: string | null;
  photoIsVerified: boolean;
  category: string | null;
  dishName: string | null;
}

// Name search — works whether or not a venue has a resolved category,
// which is the whole point (see Phase 2 Session B: ~2,700 real venues
// have no category yet, but they're real and should still be findable by
// name). Expanded query terms (from dish_name_aliases, e.g. "dose" also
// tries "dosa") are OR'd together at the SQL level so a single request
// covers every spelling.
export async function searchVenuesByName(terms: string[], limit = 20): Promise<SearchVenueRow[]> {
  const patterns = terms.map((t) => `%${t}%`);
  const rows = await sql()`
    SELECT DISTINCT ON (v.id) v.id, v.name, v.area, v.lat, v.lng, v.photo_url, v.photo_is_verified, d.category, d.name AS dish_name
    FROM venues v
    LEFT JOIN dishes d ON d.venue_id = v.id AND d.status = 'active'
    WHERE v.status = 'active' AND lower(v.name) LIKE ANY(${patterns})
    ORDER BY v.id
    LIMIT ${limit}`;
  return (rows as any[]).map((r) => ({
    id: r.id,
    name: r.name,
    area: r.area,
    lat: Number(r.lat),
    lng: Number(r.lng),
    photoUrl: r.photo_url ?? null,
    photoIsVerified: r.photo_is_verified,
    category: r.category ?? null,
    dishName: r.dish_name ?? null,
  }));
}

export interface VenueSubmission {
  id: string;
  userId: string;
  name: string;
  area: string;
  lat: number | null;
  lng: number | null;
  category: string;
  subtype: string | null;
  dishName: string | null;
  note: string;
  status: "pending" | "approved" | "rejected";
  resultingVenueId: string | null;
  createdAt: number;
  reviewedAt: number | null;
}

function venueSubmissionFromRow(r: any): VenueSubmission {
  return {
    id: r.id,
    userId: r.user_id,
    name: r.name,
    area: r.area,
    lat: r.lat !== null ? Number(r.lat) : null,
    lng: r.lng !== null ? Number(r.lng) : null,
    category: r.category,
    subtype: r.subtype ?? null,
    dishName: r.dish_name ?? null,
    note: r.note,
    status: r.status,
    resultingVenueId: r.resulting_venue_id ?? null,
    createdAt: Number(r.created_at),
    reviewedAt: r.reviewed_at !== null ? Number(r.reviewed_at) : null,
  };
}

// Cheap submit, moderator approves — same trust boundary as venue_claims:
// nothing here is live until a moderator acts on it.
export async function createVenueSubmission(s: {
  id: string;
  userId: string;
  name: string;
  area: string;
  lat: number | null;
  lng: number | null;
  category: string;
  subtype: string | null;
  dishName: string | null;
  note: string;
  now: number;
}): Promise<VenueSubmission> {
  const rows = await sql()`
    INSERT INTO venue_submissions (id, user_id, name, area, lat, lng, category, subtype, dish_name, note, created_at)
    VALUES (${s.id}, ${s.userId}, ${s.name}, ${s.area}, ${s.lat}, ${s.lng}, ${s.category}, ${s.subtype}, ${s.dishName}, ${s.note}, ${s.now})
    RETURNING *`;
  return venueSubmissionFromRow(rows[0]);
}

export async function listVenueSubmissions(status?: string): Promise<VenueSubmission[]> {
  const rows = status
    ? await sql()`SELECT * FROM venue_submissions WHERE status = ${status} ORDER BY created_at DESC`
    : await sql()`SELECT * FROM venue_submissions ORDER BY created_at DESC`;
  return rows.map(venueSubmissionFromRow);
}

export async function getVenueSubmissionById(id: string): Promise<VenueSubmission | undefined> {
  const rows = await sql()`SELECT * FROM venue_submissions WHERE id = ${id}`;
  return rows[0] ? venueSubmissionFromRow(rows[0]) : undefined;
}

// Approval creates the real venue (+ dish, if a category was given) and
// links it back to the submission in one place — a submission can only
// ever be approved once (WHERE status = 'pending' guards against a
// double-approve race the same way respondToFriendRequest does).
export async function approveVenueSubmission(
  submissionId: string,
  venue: { id: string; lat: number; lng: number; now: number },
  dish: { id: string; category: string; subtype: string } | null
): Promise<VenueSubmission | null> {
  const sub = await getVenueSubmissionById(submissionId);
  if (!sub || sub.status !== "pending") return null;

  await sql()`
    INSERT INTO venues (id, name, area, city, lat, lng, source, status, created_by, created_at, updated_at)
    VALUES (${venue.id}, ${sub.name}, ${sub.area}, 'Bengaluru', ${venue.lat}, ${venue.lng}, 'user-submitted', 'active', ${sub.userId}, ${venue.now}, ${venue.now})`;

  if (dish) {
    await sql()`
      INSERT INTO dishes (id, venue_id, category, subtype, name, source, created_by, created_at, updated_at)
      VALUES (${dish.id}, ${venue.id}, ${dish.category}, ${dish.subtype}, ${sub.dishName ?? sub.name}, 'user-submitted', ${sub.userId}, ${venue.now}, ${venue.now})`;
  }

  const rows = await sql()`
    UPDATE venue_submissions SET status = 'approved', resulting_venue_id = ${venue.id}, reviewed_at = ${venue.now}
    WHERE id = ${submissionId} AND status = 'pending'
    RETURNING *`;
  return rows[0] ? venueSubmissionFromRow(rows[0]) : null;
}

// Exact-name lookup for GPS verification (see routes/logs.ts's
// computeLocationMatch/isImpossibleTravel) — checked only after the old
// hardcoded VENUES array misses, so the 13 originally-curated venues keep
// using their precise hand-checked coordinates unchanged, while the
// 4,907 Session B venues gain the same real-GPS-verification path
// without needing Session C's careful name-matching merge first.
export async function findActiveVenueByExactName(name: string): Promise<{ lat: number; lng: number } | undefined> {
  const rows = await sql()`SELECT lat, lng FROM venues WHERE lower(name) = lower(${name}) AND status = 'active' LIMIT 1`;
  return rows[0] ? { lat: Number(rows[0].lat), lng: Number(rows[0].lng) } : undefined;
}

export async function rejectVenueSubmission(submissionId: string, now: number): Promise<VenueSubmission | null> {
  const rows = await sql()`
    UPDATE venue_submissions SET status = 'rejected', reviewed_at = ${now}
    WHERE id = ${submissionId} AND status = 'pending'
    RETURNING *`;
  return rows[0] ? venueSubmissionFromRow(rows[0]) : null;
}
