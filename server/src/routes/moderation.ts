import { Router } from "express";
import { nanoid } from "nanoid";
import * as db from "../db";
import { requireAuth, requireRole } from "../middleware";

export const moderationRouter = Router();

// Section 13: progressive enforcement, not a single verified switch.
// Every route here is deny-by-default to non-moderators (A07).
moderationRouter.use(requireAuth, requireRole("moderator", "admin"));

moderationRouter.get("/queue", async (_req, res) => {
  const held = await db.listHeldLogs();
  res.json({ ok: true, queue: held });
});

moderationRouter.post("/logs/:id/release", async (req, res) => {
  const log = await db.setLogStatus(req.params.id as string, "published");
  if (!log) return res.status(404).json({ ok: false, error: "Not found." });
  res.json({ ok: true, log });
});

moderationRouter.post("/logs/:id/remove", async (req, res) => {
  const log = await db.setLogStatus(req.params.id as string, "removed");
  if (!log) return res.status(404).json({ ok: false, error: "Not found." });
  res.json({ ok: true, log });
});

// Brief 1.5: venue-ownership claims are manually reviewed, same as held
// logs above — no automated business-registry verification exists.
moderationRouter.get("/venue-claims", async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const claims = await db.listVenueClaims(status as any);
  res.json({ ok: true, claims });
});

moderationRouter.post("/venue-claims/:id/approve", async (req, res) => {
  const claim = await db.setVenueClaimStatus(req.params.id as string, "approved");
  if (!claim) return res.status(404).json({ ok: false, error: "Not found." });
  res.json({ ok: true, claim });
});

moderationRouter.post("/venue-claims/:id/reject", async (req, res) => {
  const claim = await db.setVenueClaimStatus(req.params.id as string, "rejected");
  if (!claim) return res.status(404).json({ ok: false, error: "Not found." });
  res.json({ ok: true, claim });
});

// Phase 2 Session D: venue_submissions is the fallback for a real venue
// Session B's OSM ingestion doesn't have — same cheap-submit/moderator-
// approves shape as venue_claims above. Approval is where the trust
// boundary actually sits: submitting alone creates nothing live.
moderationRouter.get("/venue-submissions", async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const submissions = await db.listVenueSubmissions(status);
  res.json({ ok: true, submissions });
});

// A submitter isn't always able to share exact coordinates from a plain
// form — if they didn't, the moderator supplies/confirms lat/lng here
// (e.g. by looking the place up) rather than the venue getting created
// with fabricated or missing coordinates.
moderationRouter.post("/venue-submissions/:id/approve", async (req, res) => {
  const submission = await db.getVenueSubmissionById(req.params.id as string);
  if (!submission) return res.status(404).json({ ok: false, error: "Not found." });

  const lat = typeof req.body?.lat === "number" ? req.body.lat : submission.lat;
  const lng = typeof req.body?.lng === "number" ? req.body.lng : submission.lng;
  if (lat === null || lng === null || typeof lat !== "number" || typeof lng !== "number") {
    return res.status(400).json({ ok: false, error: "This submission has no coordinates — provide lat/lng to approve it." });
  }

  const now = Date.now();
  const result = await db.approveVenueSubmission(
    submission.id,
    { id: nanoid(), lat, lng, now },
    submission.category ? { id: nanoid(), category: submission.category, subtype: submission.subtype ?? "General" } : null
  );
  if (!result) return res.status(409).json({ ok: false, error: "Already reviewed." });
  res.json({ ok: true, submission: result });
});

moderationRouter.post("/venue-submissions/:id/reject", async (req, res) => {
  const result = await db.rejectVenueSubmission(req.params.id as string, Date.now());
  if (!result) return res.status(409).json({ ok: false, error: "Not found or already reviewed." });
  res.json({ ok: true, submission: result });
});
