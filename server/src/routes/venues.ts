import { Router } from "express";
import { nanoid } from "nanoid";
import { z } from "zod";
import * as db from "../db";
import { requireAuth } from "../middleware";
import { VENUES, haversineKm } from "../venues";

export const venuesRouter = Router();

const claimSchema = z.object({ venue: z.string().min(1).max(120) });

// Brief 1.5: restaurant staff self-rating disclosure starts with a claim.
// This alone grants nothing — see isApprovedOwnerOfVenue, which only ever
// looks at claims a moderator has approved. Submitting is intentionally
// cheap; the trust boundary is entirely at the approval step.
venuesRouter.post("/claim", requireAuth, async (req, res) => {
  const parsed = claimSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: "Enter the exact venue name." });
  await db.createVenueClaim({ id: nanoid(), userId: req.user!.sub, venue: parsed.data.venue, createdAt: Date.now() });
  res.status(201).json({ ok: true });
});

venuesRouter.get("/claims/mine", requireAuth, async (req, res) => {
  const claims = await db.listVenueClaims();
  res.json({ ok: true, claims: claims.filter((c) => c.userId === req.user!.sub) });
});

const querySchema = z.object({
  category: z.string(),
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  radiusKm: z.coerce.number().min(0.5).max(50).default(5),
});

// Location is used only for this one distance calculation — never stored.
// (Section 14 privacy default: precise location is never persisted or made
// public; here it isn't persisted at all, not even privately.)
venuesRouter.get("/nearby", async (req, res) => {
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: "Provide category, lat, and lng." });
  }
  const { category, lat, lng, radiusKm } = parsed.data;

  const inRange = VENUES.map((venue) => {
    const serving = venue.serves.find((s) => s.category === category);
    if (!serving) return null;
    const distanceKm = haversineKm(lat, lng, venue.lat, venue.lng);
    if (distanceKm > radiusKm) return null;
    return { venue, serving, distanceKm };
  }).filter((v): v is NonNullable<typeof v> => v !== null);

  const results = await Promise.all(
    inRange.map(async ({ venue, serving, distanceKm }) => {
      const matchingLogs = await db.listPublishedLogs(venue.name, category);
      const hasCommunityData = matchingLogs.length > 0;
      const rating = hasCommunityData
        ? matchingLogs.reduce((s, l) => s + l.score, 0) / matchingLogs.length
        : serving.baseScore;

      const reviews = matchingLogs
        .filter((l) => l.note.trim().length > 0)
        .slice(0, 3)
        .map((l) => ({ verdict: l.verdict, note: l.note, score: l.score, createdAt: l.createdAt }));

      return {
        id: venue.id,
        name: venue.name,
        area: venue.area,
        distanceKm: Math.round(distanceKm * 10) / 10,
        photo: venue.photo,
        photoIsVerified: venue.photoIsVerified,
        dishName: serving.dishName,
        rating: Math.round(rating * 10) / 10,
        ratingSource: hasCommunityData ? "community" : "baseline",
        reviewCount: matchingLogs.length,
        reviews,
      };
    })
  );

  results.sort((a, b) => a.distanceKm - b.distanceKm);

  res.json({ ok: true, category, radiusKm, count: results.length, results });
});
