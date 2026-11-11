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
  previousJti?: string | null;
  rotatedAt?: number | null;
}

export interface OtpRecord {
  code: string;
  expiresAt: number;
  attempts: number;
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
  return { familyId: r.family_id, userId: r.user_id, deviceId: r.device_id, currentJti: r.current_jti, revoked: r.revoked, previousJti: r.previous_jti ?? null, rotatedAt: r.rotated_at == null ? null : Number(r.rotated_at) };
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

export async function getFamily(familyId: string): Promise<RefreshFamily | undefined> {
  const rows = await sql()`SELECT * FROM refresh_families WHERE family_id = ${familyId}`;
  return rows[0] ? familyFromRow(rows[0]) : undefined;
}

export async function revokeFamily(familyId: string): Promise<void> {
  await sql()`UPDATE refresh_families SET revoked = true WHERE family_id = ${familyId}`;
}

export function createRefreshRotation(connect: typeof sql = sql) {
  return async (familyId: string, oldJti: string, newJti: string): Promise<boolean> => {
    const rows = await connect()`UPDATE refresh_families SET previous_jti = current_jti, current_jti = ${newJti}, rotated_at = ${Date.now()}
      WHERE family_id = ${familyId} AND current_jti = ${oldJti} AND NOT revoked RETURNING family_id`;
    return rows.length === 1;
  };
}
export const rotateFamilyJti = createRefreshRotation();

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

export async function logSecurityEvent(type: string, detail: string): Promise<void> {
  await sql()`INSERT INTO security_events (type, detail, at) VALUES (${type}, ${detail}, ${Date.now()})`;
  // eslint-disable-next-line no-console
  console.warn(`[security] ${type}: ${detail}`);
}
