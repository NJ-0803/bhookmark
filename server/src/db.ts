// Real persistent data layer (Neon Postgres) — replaces the in-memory Maps
// this started as. That version worked for local dev but silently lost all
// data on every restart and couldn't share state across serverless
// invocations; this is the actual production data layer.
import { neon } from "@neondatabase/serverless";

function sql() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");
  return neon(url);
}

export type Role = "user" | "restaurant_owner" | "moderator" | "trust_analyst" | "admin";
export type EvidenceLevel = "declared" | "live-capture" | "visit-consistent" | "transaction-supported";
export type LogStatus = "published" | "held" | "removed";
export type DietaryProfile = "no-restriction" | "vegetarian" | "vegan" | "jain" | "eggetarian";

export interface User {
  id: string;
  phone: string;
  role: Role;
  dietaryProfile: DietaryProfile;
  allergens: string[];
  createdAt: number;
}

export interface Device {
  id: string;
  userId: string;
  familyId: string;
  createdAt: number;
  lastSeenAt: number;
  label: string;
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
}

export interface PushSubscriptionJSON {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface AiCorrection {
  id: string;
  userId: string;
  aiSuggestion: unknown;
  userCorrection: unknown;
  createdAt: number;
}

function userFromRow(r: any): User {
  return {
    id: r.id,
    phone: r.phone,
    role: r.role,
    dietaryProfile: r.dietary_profile,
    allergens: r.allergens ?? [],
    createdAt: Number(r.created_at),
  };
}

function deviceFromRow(r: any): Device {
  return { id: r.id, userId: r.user_id, familyId: r.family_id, createdAt: Number(r.created_at), lastSeenAt: Number(r.last_seen_at), label: r.label };
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
  await db`INSERT INTO devices (id, user_id, family_id, label, created_at, last_seen_at) VALUES (${device.id}, ${device.userId}, ${device.familyId}, ${device.label}, ${device.createdAt}, ${device.lastSeenAt})`;
  await db`INSERT INTO refresh_families (family_id, user_id, device_id, current_jti, revoked) VALUES (${family.familyId}, ${family.userId}, ${family.deviceId}, ${family.currentJti}, false)`;
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
    INSERT INTO logs (id, user_id, category, subtype, name, venue, verdict, score, note, evidence_level, verified, status, device_id, created_at)
    VALUES (${log.id}, ${log.userId}, ${log.category}, ${log.subtype}, ${log.name}, ${log.venue}, ${log.verdict}, ${log.score}, ${log.note}, ${log.evidenceLevel}, ${log.verified}, ${log.status}, ${log.deviceId}, ${log.createdAt})`;
}

export async function getLogById(id: string): Promise<DishLog | undefined> {
  const rows = await sql()`SELECT * FROM logs WHERE id = ${id}`;
  return rows[0] ? logFromRow(rows[0]) : undefined;
}

export async function deleteLog(id: string): Promise<void> {
  await sql()`DELETE FROM logs WHERE id = ${id}`;
}

export async function listLogsForUser(userId: string): Promise<DishLog[]> {
  const rows = await sql()`SELECT * FROM logs WHERE user_id = ${userId} ORDER BY created_at DESC`;
  return rows.map(logFromRow);
}

export async function listPublishedLogs(venue: string, category: string): Promise<DishLog[]> {
  const rows = await sql()`SELECT * FROM logs WHERE venue = ${venue} AND category = ${category} AND status = 'published' ORDER BY created_at DESC`;
  return rows.map(logFromRow);
}

export async function listPublishedLogsByCategorySubtype(category: string, subtype: string): Promise<DishLog[]> {
  const rows = await sql()`SELECT * FROM logs WHERE category = ${category} AND subtype = ${subtype} AND status = 'published'`;
  return rows.map(logFromRow);
}

// Score separation (brief section 1.2): the category+subtype aggregate above
// is city-wide and too coarse to be "this dish's score" — this narrows to
// the exact venue+category+subtype+name a dish profile page actually shows.
export async function listPublishedLogsForDish(venue: string, category: string, subtype: string, name: string): Promise<DishLog[]> {
  const rows = await sql()`
    SELECT * FROM logs
    WHERE venue = ${venue} AND category = ${category} AND subtype = ${subtype} AND name = ${name} AND status = 'published'`;
  return rows.map(logFromRow);
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

// ---------- AI corrections (eval-only) ----------

export async function recordAiCorrection(c: AiCorrection): Promise<void> {
  await sql()`
    INSERT INTO ai_corrections (id, user_id, ai_suggestion, user_correction, created_at)
    VALUES (${c.id}, ${c.userId}, ${JSON.stringify(c.aiSuggestion)}, ${JSON.stringify(c.userCorrection)}, ${c.createdAt})`;
}

export async function listAiCorrections(limit = 50): Promise<AiCorrection[]> {
  const rows = await sql()`SELECT * FROM ai_corrections ORDER BY created_at DESC LIMIT ${limit}`;
  return rows.map((r: any) => ({
    id: r.id,
    userId: r.user_id,
    aiSuggestion: r.ai_suggestion,
    userCorrection: r.user_correction,
    createdAt: Number(r.created_at),
  }));
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
