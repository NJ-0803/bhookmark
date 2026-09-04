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

// Brief 1.5: "multiple accounts from the same device or network." Fires
// only on real distinct-ACCOUNT volume from one IP, not request volume —
// a shared office/hostel network with several real, already-existing
// accounts never triggers this; a burst of new signups from one IP does.
const MULTI_ACCOUNT_THRESHOLD = 4;
const MULTI_ACCOUNT_WINDOW_MS = 24 * 60 * 60 * 1000;
async function isMultiAccountNetwork(ip: string | undefined): Promise<boolean> {
  if (!ip) return false;
  const distinctUsers = await db.countDistinctUsersFromIp(ip, MULTI_ACCOUNT_WINDOW_MS);
  return distinctUsers >= MULTI_ACCOUNT_THRESHOLD;
}

// Brief 1.5: "repeated delete-and-repost behaviour." One delete-and-repost
// is normal (typo fix, changed mind) — the THIRD cycle at the same venue
// inside a day is the pattern worth a human look.
const DELETE_REPOST_THRESHOLD = 2;
const DELETE_REPOST_WINDOW_MS = 24 * 60 * 60 * 1000;
async function isRepeatedDeleteRepost(userId: string, venue: string): Promise<boolean> {
  const recentDeletions = await db.countRecentDeletions(userId, venue, DELETE_REPOST_WINDOW_MS);
  return recentDeletions >= DELETE_REPOST_THRESHOLD;
}

// Location-spoofing guard: two location-verified logs at known venues too
// far apart to have genuinely traveled between in the elapsed time. Only
// evaluated when BOTH logs are real GPS-matched (never on freeform venues
// this app can't verify coordinates for, which would only produce false
// positives) — deliberately conservative thresholds to avoid flagging a
// real commute or a second real visit later in the day.
// Calibrated to this app's actual venue set (all within Bangalore city,
// max real inter-venue distance ~9km) rather than a generic "impossible
// travel" number — 6km in under 10 minutes implies >36km/h sustained
// through city traffic including the time spent using the app at both
// ends, implausible without a highway, but not physically impossible, so
// this stays a hold-for-review signal rather than a hard block.
const IMPOSSIBLE_TRAVEL_MIN_KM = 6;
const IMPOSSIBLE_TRAVEL_MAX_MINUTES = 10;
async function isImpossibleTravel(userId: string, venue: string, now: number): Promise<boolean> {
  const known = VENUES.find((v) => v.name.toLowerCase() === venue.trim().toLowerCase());
  if (!known) return false;
  const prev = await db.mostRecentLocationVerifiedLog(userId, venue);
  if (!prev) return false;
  const prevKnown = VENUES.find((v) => v.name.toLowerCase() === prev.venue.trim().toLowerCase());
  if (!prevKnown) return false;
  const distanceKm = haversineKm(known.lat, known.lng, prevKnown.lat, prevKnown.lng);
  if (distanceKm < IMPOSSIBLE_TRAVEL_MIN_KM) return false;
  const elapsedMinutes = Math.abs(now - prev.createdAt) / 60000;
  return elapsedMinutes < IMPOSSIBLE_TRAVEL_MAX_MINUTES;
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
  const now = Date.now();

  const liveLocationMatch = computeLocationMatch(data.venue, data.evidence.location);
  const level = evidenceLevel(data.evidence.livePhoto, liveLocationMatch, data.evidence.receipt);

  // Four independent ranking-manipulation signals (brief 1.5), each with
  // its own auditable record — held for review, never auto-blocked. Any
  // one firing is enough; they're deliberately not weighted/combined so
  // each stays individually inspectable in security_events.
  const userId = req.user!.sub;
  const [burstHeld, networkHeld, deleteRepostHeld, travelHeld, ownerDisclosed] = await Promise.all([
    isBurst(data.deviceId, data.venue),
    isMultiAccountNetwork(req.ip),
    isRepeatedDeleteRepost(userId, data.venue),
    liveLocationMatch ? isImpossibleTravel(userId, data.venue, now) : Promise.resolve(false),
    db.isApprovedOwnerOfVenue(userId, data.venue),
  ]);
  const held = burstHeld || networkHeld || deleteRepostHeld || travelHeld;

  if (held) {
    const reasons = [
      burstHeld && "venue_burst",
      networkHeld && "multi_account_network",
      deleteRepostHeld && "repeated_delete_repost",
      travelHeld && "impossible_travel",
    ].filter(Boolean);
    await db.logSecurityEvent("log_held_for_review", `user=${userId} venue=${data.venue} reasons=${reasons.join(",")}`);
  }

  const log: DishLog = {
    id: nanoid(),
    userId,
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
    createdAt: now,
    locationVerified: liveLocationMatch,
    ownerDisclosed,
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
  // Survives the deletion on purpose — see isRepeatedDeleteRepost above.
  await db.recordLogDeletion(log.userId, log.venue, log.category, log.subtype, log.name);
  res.json({ ok: true });
});
