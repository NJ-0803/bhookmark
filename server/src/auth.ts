import jwt from "jsonwebtoken";
import { nanoid } from "nanoid";
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
}

export function issueAccessToken(userId: string, role: Role, authTime: number) {
  return jwt.sign({ sub: userId, role, authTime } satisfies AccessPayload, ACCESS_SECRET, {
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

export function newOtp(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export async function findOrCreateUser(phone: string) {
  return dbFindOrCreateUser(phone, nanoid());
}

/** A02/A01 mitigation: a generic, timing-flat response so requesting an OTP
 * or verifying one never reveals whether a phone number is registered. */
export const GENERIC_OTP_ERROR = { ok: false, error: "That code is invalid or has expired." };
