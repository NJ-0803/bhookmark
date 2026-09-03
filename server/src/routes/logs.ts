import { Router } from "express";
import { z } from "zod";
import { nanoid } from "nanoid";
import * as db from "../db";
import type { DishLog, EvidenceLevel } from "../db";
import { requireAuth } from "../middleware";
import { VENUES, haversineKm } from "../venues";
import { detectDish, visionConfigured } from "../vision";

export const logsRouter = Router();

const createSchema = z.object({
  category: z.string(),
  subtype: z.string(),
  name: z.string().min(1).max(120),
  venue: z.string().min(1).max(120),
  verdict: z.enum(["loved", "fine", "not-for-me"]),
  score: z.number().min(0).max(10),
  note: z.string().max(300).default(""),
  deviceId: z.string(),
  evidence: z.object({
    livePhoto: z.boolean(),
    receipt: z.boolean().default(false),
    // Real coordinates from navigator.geolocation, or null if the browser
    // permission was denied/skipped — this replaces a client-asserted
    // "liveLocationMatch" boolean, which was pure trust-me UI state.
    location: z.object({ lat: z.number(), lng: z.number() }).nullable().default(null),
  }),
});

// A real position was captured, cross-checked against this app's own known
// venue coordinates where possible. An unrecognized (freeform, user-typed)
// venue can't be cross-checked, so a captured position still counts as
// best-effort evidence — weaker than a confirmed match, but still a real
// browser-granted permission, not a client-side toggle switch.
function computeLocationMatch(venueName: string, location: { lat: number; lng: number } | null): boolean {
  if (!location) return false;
  const known = VENUES.find((v) => v.name.toLowerCase() === venueName.trim().toLowerCase());
  if (!known) return true;
  return haversineKm(location.lat, location.lng, known.lat, known.lng) < 1;
}

function evidenceLevel(livePhoto: boolean, liveLocationMatch: boolean, receipt: boolean): EvidenceLevel {
  if (receipt) return "transaction-supported";
  if (livePhoto && liveLocationMatch) return "live-capture";
  if (livePhoto || liveLocationMatch) return "visit-consistent";
  return "declared";
}

// T-01/T-04-style velocity guard: too many logs for the same venue from the
// same device in a short window gets held for review instead of published.
// This is a deliberately naive stand-in for the real system's multi-signal
// (device + network + text-similarity + image-hash + graph) detection.
async function isBurst(deviceId: string, venue: string): Promise<boolean> {
  const key = `${deviceId}:${venue}`;
  const count = await db.recordVenueHit(key, Date.now(), 10 * 60 * 1000);
  return count > 5;
}

// F-10/F-11: idempotency — a retried or double-submitted request with the
// same key returns the original result instead of creating a duplicate log.
logsRouter.post("/", requireAuth, async (req, res) => {
  const idempotencyKey = req.header("Idempotency-Key");
  const idKey = idempotencyKey ? `${req.user!.sub}:${idempotencyKey}` : null;
  if (idKey) {
    const cached = await db.getIdempotent(idKey);
    if (cached) return res.status(cached.status).json(cached.body);
  }

  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    const body = { ok: false, error: "Invalid log payload.", issues: parsed.error.issues };
    if (idKey) await db.setIdempotent(idKey, 400, body);
    return res.status(400).json(body);
  }
  const data = parsed.data;

  const liveLocationMatch = computeLocationMatch(data.venue, data.evidence.location);
  const level = evidenceLevel(data.evidence.livePhoto, liveLocationMatch, data.evidence.receipt);
  const held = await isBurst(data.deviceId, data.venue);

  const log: DishLog = {
    id: nanoid(),
    userId: req.user!.sub,
    category: data.category,
    subtype: data.subtype,
    name: data.name,
    venue: data.venue,
    verdict: data.verdict,
    score: data.score,
    note: data.note,
    evidenceLevel: level,
    verified: level !== "declared",
    status: held ? "held" : "published",
    deviceId: data.deviceId,
    createdAt: Date.now(),
  };
  await db.createLog(log);

  const body = { ok: true, log };
  if (idKey) await db.setIdempotent(idKey, 201, body);
  res.status(201).json(body);
});

// Section 1.3 (AI dish recognition): whether the client should show a
// camera-first flow at all. Without a configured vendor key, the client
// should skip straight to manual entry rather than dead-end into a spinner.
logsRouter.get("/detect/status", requireAuth, (_req, res) => {
  res.json({ ok: true, configured: visionConfigured() });
});

const DAILY_DETECT_LIMIT = 15;

const detectSchema = z.object({
  imageBase64: z.string().min(1),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
});

// Real image analysis, scoped per the brief: never fabricates confidence,
// never blocks manual logging on failure, never persists the photo (there is
// no object storage yet — see the implementation plan's Q1 decision). The
// per-user daily cap only counts requests that actually reach the vendor,
// not ones short-circuited by a missing key or bad payload.
logsRouter.post("/detect", requireAuth, async (req, res) => {
  const parsed = detectSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: "Expected a base64 image and a supported mime type.", issues: parsed.error.issues });
  }

  if (!visionConfigured()) {
    return res.json({ ok: false, error: "vision_not_configured" });
  }

  const dailyCount = await db.recordVenueHit(`ai-detect:${req.user!.sub}`, Date.now(), 24 * 60 * 60 * 1000);
  if (dailyCount > DAILY_DETECT_LIMIT) {
    return res.status(429).json({ ok: false, error: `Daily AI-detect limit reached (${DAILY_DETECT_LIMIT}/day) — enter the dish manually instead.` });
  }

  const result = await detectDish(parsed.data.imageBase64, parsed.data.mimeType);
  res.json(result);
});

const correctionSchema = z.object({
  aiSuggestion: z.unknown(),
  userCorrection: z.unknown(),
});

// Passive eval logging only (brief 1.3: "user corrections are logged for
// evaluation, not automatically used as unreviewed training data") — this
// never feeds back into detectDish() or any ranking/recommendation path.
logsRouter.post("/correction", requireAuth, async (req, res) => {
  const parsed = correctionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: "Invalid correction payload." });

  await db.recordAiCorrection({
    id: nanoid(),
    userId: req.user!.sub,
    aiSuggestion: parsed.data.aiSuggestion,
    userCorrection: parsed.data.userCorrection,
    createdAt: Date.now(),
  });
  res.json({ ok: true });
});

logsRouter.get("/mine", requireAuth, async (req, res) => {
  const mine = await db.listLogsForUser(req.user!.sub);
  res.json({ ok: true, logs: mine });
});

// A08: object-level authorization — a log can only be read/deleted by its
// owner (or a moderator), never by guessing another user's log id.
logsRouter.get("/:id", requireAuth, async (req, res) => {
  const log = await db.getLogById(req.params.id as string);
  if (!log || (log.userId !== req.user!.sub && req.user!.role !== "moderator")) {
    return res.status(404).json({ ok: false, error: "Log not found." });
  }
  res.json({ ok: true, log });
});

logsRouter.delete("/:id", requireAuth, async (req, res) => {
  const log = await db.getLogById(req.params.id as string);
  if (!log || log.userId !== req.user!.sub) {
    return res.status(404).json({ ok: false, error: "Log not found." });
  }
  await db.deleteLog(req.params.id as string);
  res.json({ ok: true });
});
