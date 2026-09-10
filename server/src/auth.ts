import jwt from "jsonwebtoken";
import { nanoid } from "nanoid";
import { randomInt } from "node:crypto";
import { findOrCreateUser as dbFindOrCreateUser, Role } from "./db";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name}`);
  return v;
}

const ACCESS_SECRET = requireEnv("JWT_ACCESS_SECRET");
const REFRESH_SECRET = requireEnv("JWT_REFRESH_SECRET");

const ACCESS_TTL_S = 15 * 60; // 15 min
const REFRESH_TTL_S = 30 * 24 * 60 * 60; // 30 days

export interface AccessPayload {
  sub: string; // userId
  role: Role;
  authTime: number; // seconds since epoch when the user last completed OTP
  // F05 (implementation brief, 2026-09-08): the device a control like the
  // venue-burst check binds to must come from the server-issued session,
  // never from a string the client can put in a request body — otherwise
  // anyone can defeat per-device rate limiting just by sending a different
  // deviceId on each call.
  deviceId: string;
}

export function issueAccessToken(userId: string, role: Role, authTime: number, deviceId: string) {
  return jwt.sign({ sub: userId, role, authTime, deviceId } satisfies AccessPayload, ACCESS_SECRET, {
    expiresIn: ACCESS_TTL_S,
  });
}

export function verifyAccessToken(token: string): AccessPayload {
  return jwt.verify(token, ACCESS_SECRET) as AccessPayload;
}

export function issueRefreshToken(familyId: string, jti: string) {
  return jwt.sign({ familyId, jti }, REFRESH_SECRET, { expiresIn: REFRESH_TTL_S });
}

export function verifyRefreshToken(token: string): { familyId: string; jti: string } {
  return jwt.verify(token, REFRESH_SECRET) as { familyId: string; jti: string };
}

// F01: Math.random() is not a cryptographic RNG — its output is
// predictable enough (a 48-bit-ish PRNG state, sometimes seeded from the
// system clock) that an attacker who can observe a few codes can have a
// real shot at predicting the next one. node:crypto's randomInt draws from
// the OS CSPRNG instead.
export function newOtp(): string {
  return String(randomInt(100000, 1000000));
}

export async function findOrCreateUser(phone: string) {
  return dbFindOrCreateUser(phone, nanoid());
}

/** A02/A01 mitigation: a generic, timing-flat response so requesting an OTP
 * or verifying one never reveals whether a phone number is registered. */
export const GENERIC_OTP_ERROR = { ok: false, error: "That code is invalid or has expired." };
