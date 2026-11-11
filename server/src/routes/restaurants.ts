import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { coverage, getRestaurant, hasPlaces, searchGoogle, searchLocal } from "../restaurants";

export const restaurantsRouter = Router();
restaurantsRouter.use((_req, res, next) => { res.set("Cache-Control", "private, no-store"); next(); });
restaurantsRouter.use(rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: true, legacyHeaders: false,
  message: { ok: false, error: "Too many restaurant requests. Try again in a minute." } }));
restaurantsRouter.get("/coverage", async (_req, res) => res.json({ ok: true, ...await coverage() }));

const searchSchema = z.object({ q: z.string().trim().max(120).default(""), offset: z.coerce.number().int().min(0).max(100000).default(0),
  pageToken: z.string().max(4000).optional(), source: z.enum(["google", "osm"]).optional() });
restaurantsRouter.get("/search", async (req, res) => {
  const parsed = searchSchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ ok: false, error: "Check the restaurant search." });
  const { q, offset, pageToken, source } = parsed.data;
  let notice: string | null = null;
  if (hasPlaces() && source !== "osm") {
    try { return res.json({ ok: true, source: "google", ...await searchGoogle(q, pageToken), nextOffset: null, notice }); }
    catch { notice = "Live search is unavailable. These results are from our Bangalore catalog."; }
  }
  return res.json({ ok: true, source: "osm", ...await searchLocal(q, offset), nextPageToken: null, notice });
});

// A same-origin image proxy avoids exposing the API key to browsers.
// Resource validation disallows arbitrary URLs and non-Places endpoints.
restaurantsRouter.get("/photo", async (req, res) => {
  const name = typeof req.query.name === "string" ? req.query.name : "";
  if (!/^places\/[A-Za-z0-9_-]+\/photos\/[A-Za-z0-9_-]+$/.test(name) || name.length > 2000) return res.sendStatus(400);
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) return res.sendStatus(503);
  try {
    const response = await fetch(`https://places.googleapis.com/v1/${name}/media?maxWidthPx=1000&key=${encodeURIComponent(key)}`, {
      signal: AbortSignal.timeout(8000), cache: "no-store",
    });
    if (!response.ok || !response.headers.get("content-type")?.startsWith("image/")) return res.sendStatus(502);
    res.type(response.headers.get("content-type")!).send(Buffer.from(await response.arrayBuffer()));
  } catch { res.sendStatus(502); }
});
restaurantsRouter.get("/:id", async (req, res) => {
  try {
    const restaurant = await getRestaurant(req.params.id as string);
    if (!restaurant) return res.status(404).json({ ok: false, error: "Restaurant not found." });
    return res.json({ ok: true, restaurant });
  } catch { return res.status(503).json({ ok: false, error: "Couldn't load this restaurant. Your saved dishes are still available." }); }
});
