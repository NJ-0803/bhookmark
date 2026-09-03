import { Router } from "express";
import { z } from "zod";
import { nanoid } from "nanoid";
import * as db from "../db";
import type { DishLog, EvidenceLevel } from "../db";
import { requireAuth } from "../middleware";
import { VENUES, haversineKm } from "../venues";

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
