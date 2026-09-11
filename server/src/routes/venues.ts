import { Router } from "express";
import { nanoid } from "nanoid";
import { z } from "zod";
import * as db from "../db";
import { requireAuth } from "../middleware";
import { haversineKm } from "../venues";
import { resolveCategory, resolveCategoryFromCandidates, expandDishNameQuery, type AliasMap } from "../aliases";

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

async function getAliasMap(): Promise<AliasMap> {
  return db.getCategoryAliasMap();
}

// Degrees-per-km at this latitude — longitude degrees shrink toward the
// poles (cos(lat)), latitude degrees don't. Used only to size a SQL
// bounding-box prefilter; the route still computes exact haversine
// distance and does the real radius cut in JS, same as the old hardcoded
// array did (see the Phase 2 plan's explicit no-PostGIS decision).
function bboxForRadius(lat: number, lng: number, radiusKm: number) {
  const latDelta = radiusKm / 111;
  const lngDelta = radiusKm / (111 * Math.max(Math.cos((lat * Math.PI) / 180), 0.1));
  return { latMin: lat - latDelta, latMax: lat + latDelta, lngMin: lng - lngDelta, lngMax: lng + lngDelta };
}

const nearbySchema = z.object({
  category: z.string(),
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  radiusKm: z.coerce.number().min(0.5).max(50).default(5),
});

// Phase 2 Session D: reads the real venues/dishes tables (Session B's OSM
// ingestion + whatever seed/user-submitted data joins them) instead of
// the old hardcoded 13-venue array. Category resolution goes through
// category_aliases first (server/src/aliases.ts) — this is the direct,
// structural fix for the exact bug that shipped in Phase 1 (frontend
// said "Coffee", the old array still said "Filter Coffee", exact-match
// silently returned zero results): a spelling only has to be correct in
// the alias table now, not re-derived at every call site.
//
// Location is used only for this one distance calculation — never
// stored (Section 14 privacy default: precise location is never
// persisted or made public; here it isn't persisted at all, not even
// privately).
venuesRouter.get("/nearby", async (req, res) => {
  const parsed = nearbySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: "Provide category, lat, and lng." });
  }
  const { category: rawCategory, lat, lng, radiusKm } = parsed.data;

  const aliasMap = await getAliasMap();
  const category = resolveCategory(rawCategory, aliasMap);
  if (!category) {
    return res.json({ ok: true, category: rawCategory, radiusKm, count: 0, results: [], categoryResolved: false });
  }

  const bbox = bboxForRadius(lat, lng, radiusKm);
  const rows = await db.listVenuesNearbyByCategory(category, bbox);

  const inRange = rows
    .map((v) => {
      const distanceKm = haversineKm(lat, lng, v.lat, v.lng);
      if (distanceKm > radiusKm) return null;
      return { venue: v, distanceKm };
    })
    .filter((v): v is NonNullable<typeof v> => v !== null);

  // Real evidence-gated rating (Phase 1's honesty fix, applied to real
  // data now) — never a fabricated baseline score. OSM-sourced dishes
  // have no score field at all; "no logs yet" is the only honest state
  // until someone actually logs a visit. One batched query for every
  // venue in range, not one query per venue (see
  // listPublishedLogsForVenues's comment for why that mattered).
  const logsByVenue = await db.listPublishedLogsForVenues(inRange.map((r) => r.venue.name), category);

  const results = inRange.map(({ venue, distanceKm }) => {
    const matchingLogs = logsByVenue.get(venue.name) ?? [];
    const reviews = matchingLogs
      .filter((l) => l.note.trim().length > 0)
      .slice(0, 3)
      .map((l) => ({ verdict: l.verdict, note: l.note, score: l.score, createdAt: l.createdAt }));

    return {
      id: venue.id,
      name: venue.name,
      area: venue.area,
      distanceKm: Math.round(distanceKm * 10) / 10,
      photo: venue.photoUrl,
      photoIsVerified: venue.photoIsVerified,
      dishName: venue.dishName,
      community: {
        score: matchingLogs.length ? Math.round((matchingLogs.reduce((s, l) => s + l.score, 0) / matchingLogs.length) * 10) / 10 : null,
        count: matchingLogs.length,
      },
      reviews,
    };
  });

  results.sort((a, b) => a.distanceKm - b.distanceKm);

  res.json({ ok: true, category, radiusKm, count: results.length, results, categoryResolved: true });
});

const searchSchema = z.object({
  q: z.string().trim().min(2).max(80),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
});

// Name search — works whether or not a venue has a resolved category.
// This is the actual fix for "when a user searches for a particular
// cafe/bakery/pub, it appears": Session B's OSM ingestion inserts every
// real, named venue unconditionally, specifically so this endpoint has
// something to search even for the ~2,700 venues no category could be
// confidently guessed for.
venuesRouter.get("/search", async (req, res) => {
  const parsed = searchSchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ ok: false, error: "Enter at least 2 characters to search." });
  const { q, lat, lng } = parsed.data;

  const dishAliases = await db.getDishNameAliasMap();
  const terms = expandDishNameQuery(q, dishAliases).map((t) => t.toLowerCase());
  const rows = await db.searchVenuesByName(terms, 20);

  const results = rows.map((v) => ({
    id: v.id,
    name: v.name,
    area: v.area,
    category: v.category,
    dishName: v.dishName,
    photo: v.photoUrl,
    photoIsVerified: v.photoIsVerified,
    distanceKm: lat !== undefined && lng !== undefined ? Math.round(haversineKm(lat, lng, v.lat, v.lng) * 10) / 10 : null,
  }));

  if (lat !== undefined && lng !== undefined) {
    results.sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity));
  }

  res.json({ ok: true, query: q, count: results.length, results });
});

const submitSchema = z.object({
  name: z.string().trim().min(2).max(120),
  area: z.string().trim().min(2).max(80),
  lat: z.number().min(-90).max(90).nullable().default(null),
  lng: z.number().min(-180).max(180).nullable().default(null),
  category: z.string().trim().min(2).max(60),
  subtype: z.string().trim().max(60).nullable().default(null),
  dishName: z.string().trim().max(120).nullable().default(null),
  note: z.string().trim().max(300).default(""),
});

// Cheap submit, moderator approves — the fallback for a real venue that
// exists but that Session B's OSM ingestion doesn't have yet (not every
// real place is mapped on OpenStreetMap). Same trust boundary as
// venue_claims: this alone makes nothing live.
venuesRouter.post("/submit", requireAuth, async (req, res) => {
  const parsed = submitSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: "Enter at least a name, area and category." });
  const data = parsed.data;

  const aliasMap = await getAliasMap();
  const category = resolveCategoryFromCandidates([data.category], aliasMap);
  if (!category) {
    return res.status(400).json({ ok: false, error: `"${data.category}" isn't a recognized category yet — pick one from the list.` });
  }

  const submission = await db.createVenueSubmission({
    id: nanoid(),
    userId: req.user!.sub,
    name: data.name,
    area: data.area,
    lat: data.lat,
    lng: data.lng,
    category,
    subtype: data.subtype,
    dishName: data.dishName,
    note: data.note,
    now: Date.now(),
  });
  res.status(201).json({ ok: true, submission: { id: submission.id, status: submission.status } });
});

venuesRouter.get("/submissions/mine", requireAuth, async (req, res) => {
  const all = await db.listVenueSubmissions();
  res.json({ ok: true, submissions: all.filter((s) => s.userId === req.user!.sub) });
});
