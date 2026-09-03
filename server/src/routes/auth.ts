import { Router } from "express";
import { z } from "zod";
import { nanoid } from "nanoid";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import * as db from "../db";
import {
  findOrCreateUser,
  GENERIC_OTP_ERROR,
  issueAccessToken,
  issueRefreshToken,
  newOtp,
  verifyRefreshToken,
} from "../auth";
import { requireAuth } from "../middleware";

export const authRouter = Router();

// A01: bound OTP requests per phone number, independent of the global
// per-IP limiter in index.ts (a shared office/hostel network shouldn't
// starve one phone number's ability to request a code, and vice versa).
const otpRequestLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 3,
  keyGenerator: (req) => (req.body?.phone ? `otp-req:${req.body.phone}` : `otp-req:${ipKeyGenerator(req.ip ?? "")}`),
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: "Too many codes requested. Try again in a few minutes." },
});

const otpVerifyLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 8,
  keyGenerator: (req) => (req.body?.phone ? `otp-verify:${req.body.phone}` : `otp-verify:${ipKeyGenerator(req.ip ?? "")}`),
  standardHeaders: true,
  legacyHeaders: false,
  message: GENERIC_OTP_ERROR,
});

const phoneSchema = z.object({ phone: z.string().min(8).max(15) });

authRouter.post("/otp/request", otpRequestLimiter, async (req, res) => {
  const parsed = phoneSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: "Enter a valid phone number." });
  const { phone } = parsed.data;

  const code = newOtp();
  await db.setOtp(phone, { code, expiresAt: Date.now() + 5 * 60 * 1000, attempts: 0 });

  // DEV ONLY: a real deployment sends this via an SMS vendor and never
  // returns it in the API response. We have no SMS provider wired up, so
  // this is surfaced to the client and clearly labeled as a dev shortcut.
  res.json({ ok: true, devOtp: code, expiresInSeconds: 300 });
});

const verifySchema = z.object({ phone: z.string(), otp: z.string().length(6), deviceLabel: z.string().default("Unknown device") });

authRouter.post("/otp/verify", otpVerifyLimiter, async (req, res) => {
  const parsed = verifySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(GENERIC_OTP_ERROR);
  const { phone, otp, deviceLabel } = parsed.data;

  const record = await db.getOtp(phone);
  if (!record || record.expiresAt < Date.now()) return res.status(400).json(GENERIC_OTP_ERROR);

  if (record.attempts >= 5) {
    await db.deleteOtp(phone);
    return res.status(429).json({ ok: false, error: "Too many attempts. Request a new code." });
  }

  if (record.code !== otp) {
    await db.incrementOtpAttempts(phone);
    return res.status(400).json(GENERIC_OTP_ERROR);
  }

  await db.deleteOtp(phone);
  const user = await findOrCreateUser(phone);

  const deviceId = nanoid();
  const familyId = nanoid();
  const jti = nanoid();
  const now = Date.now();
  await db.createDeviceAndFamily(
    { id: deviceId, userId: user.id, familyId, createdAt: now, lastSeenAt: now, label: deviceLabel },
    { familyId, userId: user.id, deviceId, currentJti: jti, revoked: false }
  );

  const authTime = Math.floor(Date.now() / 1000);
  res.json({
    ok: true,
    user: { id: user.id, phone: user.phone, role: user.role },
    accessToken: issueAccessToken(user.id, user.role, authTime),
    refreshToken: issueRefreshToken(familyId, jti),
    deviceId,
  });
});

const refreshSchema = z.object({ refreshToken: z.string() });

authRouter.post("/refresh", async (req, res) => {
  const parsed = refreshSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: "Missing refresh token." });

  let payload: { familyId: string; jti: string };
  try {
    payload = verifyRefreshToken(parsed.data.refreshToken);
  } catch {
    return res.status(401).json({ ok: false, error: "Session expired. Sign in again." });
  }

  const family = await db.getFamily(payload.familyId);
  if (!family || family.revoked) {
    return res.status(401).json({ ok: false, error: "Session revoked. Sign in again." });
  }

  // A04: refresh-token reuse detection. If the jti presented isn't the
  // current one for this family, someone replayed an old (likely stolen)
  // token — revoke the whole family rather than trusting either caller.
  if (family.currentJti !== payload.jti) {
    await db.revokeFamily(family.familyId);
    await db.logSecurityEvent("refresh_token_reuse", `family=${family.familyId} user=${family.userId}`);
    return res.status(401).json({ ok: false, error: "Session revoked for your safety. Sign in again." });
  }

  const user = await db.getUserById(family.userId);
  if (!user) return res.status(401).json({ ok: false, error: "Session revoked. Sign in again." });

  const newJti = nanoid();
  await db.rotateFamilyJti(family.familyId, newJti);
  await db.touchDevice(family.deviceId);

  const authTime = Math.floor(Date.now() / 1000);
  res.json({
    ok: true,
    accessToken: issueAccessToken(user.id, user.role, authTime),
    refreshToken: issueRefreshToken(family.familyId, newJti),
  });
});

authRouter.get("/sessions", requireAuth, async (req, res) => {
  const devices = await db.listDevicesForUser(req.user!.sub);
  const sessions = await Promise.all(
    devices.map(async (d) => ({
      deviceId: d.id,
      label: d.label,
      createdAt: d.createdAt,
      lastSeenAt: d.lastSeenAt,
      revoked: (await db.getFamily(d.familyId))?.revoked ?? true,
    }))
  );
  res.json({ ok: true, sessions });
});

// A08/A09: object-level check — only the owning user can revoke their own device.
authRouter.delete("/sessions/:deviceId", requireAuth, async (req, res) => {
  const device = await db.getDevice(req.params.deviceId as string);
  if (!device || device.userId !== req.user!.sub) {
    return res.status(404).json({ ok: false, error: "Session not found." });
  }
  await db.revokeFamily(device.familyId);
  res.json({ ok: true });
});
