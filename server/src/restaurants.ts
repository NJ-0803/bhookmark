import { sql } from "./bookmarks";

// Bangalore metro search boundary, including the suburbs omitted by the old
// 12.90..13.02 seed import. This is a search region, not a completeness claim.
export const BANGALORE = { low: { latitude: 12.75, longitude: 77.30 }, high: { latitude: 13.25, longitude: 77.90 } };
export interface RestaurantPhoto {
  url: string;
  sourceUrl: string;
  authors: { name: string; url: string }[];
}
export interface Restaurant {
  id: string; name: string; address: string; lat: number; lng: number;
  source: "google" | "osm"; mapsUrl: string; photos: RestaurantPhoto[];
  attributions?: { provider: string; providerUri: string }[];
}
export class PlacesUnavailable extends Error {}
export const hasPlaces = () => Boolean(process.env.GOOGLE_PLACES_API_KEY);
const fields = "id,displayName,formattedAddress,location,photos,googleMapsUri,attributions,types";
const foodTypes = new Set(["restaurant", "cafe", "bakery", "bar", "meal_takeaway", "meal_delivery", "food_court", "ice_cream_shop", "coffee_shop", "pub"]);
const isFood = (types: string[] = []) => types.some((type) => foodTypes.has(type) || type.endsWith("_restaurant"));
const inBangalore = (lat: number, lng: number) => Number.isFinite(lat) && Number.isFinite(lng) && lat >= BANGALORE.low.latitude && lat <= BANGALORE.high.latitude && lng >= BANGALORE.low.longitude && lng <= BANGALORE.high.longitude;

export async function places(path: string, mask: string, body?: unknown): Promise<any> {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) throw new PlacesUnavailable("Restaurant photo provider is not connected.");
  const res = await fetch(`https://places.googleapis.com/v1/${path}`, {
    method: body ? "POST" : "GET", signal: AbortSignal.timeout(8000), cache: "no-store",
    headers: { "X-Goog-Api-Key": key, "X-Goog-FieldMask": mask, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) throw new PlacesUnavailable("Live restaurant search is unavailable. Showing the local catalog instead.");
  return res.json();
}

function googleRestaurant(p: any): Restaurant {
  const mapsUrl = p.googleMapsUri || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.displayName?.text || "Restaurant")}&query_place_id=${encodeURIComponent(p.id)}`;
  return { id: `google:${p.id}`, name: p.displayName?.text ?? "Restaurant", address: p.formattedAddress || "Bengaluru",
    lat: p.location?.latitude, lng: p.location?.longitude, source: "google", mapsUrl,
    photos: (p.photos ?? []).slice(0, 5).map((photo: any) => ({
      // Only transient metadata is returned. No Google photos, photo names,
      // provider ratings or restaurant-details snapshots are persisted.
      url: `/restaurants/photo?name=${encodeURIComponent(photo.name)}`,
      sourceUrl: photo.googleMapsUri || mapsUrl,
      authors: (photo.authorAttributions ?? []).map((a: any) => ({ name: a.displayName, url: a.uri })),
    })),
    attributions: p.attributions ?? [],
  };
}

export async function searchGoogle(q: string, pageToken?: string) {
  const result = await places("places:searchText", fields.split(",").map((f) => `places.${f}`).join(",") + ",nextPageToken", {
    textQuery: `${q || "restaurants cafes bakeries"} in Bengaluru`, pageSize: 20,
    locationRestriction: { rectangle: BANGALORE }, ...(pageToken ? { pageToken } : {}),
  });
  return { restaurants: (result.places ?? []).filter((p: any) => isFood(p.types) && inBangalore(p.location?.latitude, p.location?.longitude)).map(googleRestaurant), nextPageToken: result.nextPageToken ?? null };
}

function localRestaurant(v: Record<string, any>): Restaurant {
  return { id: `osm:${v.id}`, name: v.name, address: `${v.area}, Bengaluru`, lat: v.lat, lng: v.lng,
    source: "osm", mapsUrl: `https://www.google.com/maps/search/?api=1&query=${v.lat},${v.lng}`,
    // Legacy photos were generic placeholders or seed images without a
    // reliable per-branch provenance. Do not promote them to real photos.
    photos: [] };
}

export async function searchLocal(q: string, offset = 0, connect: typeof sql = sql) {
  const db = connect();
  const pattern = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
  const rows = await db`SELECT id, name, area, lat, lng FROM venues
    WHERE status = 'active' AND lat BETWEEN 12.75 AND 13.25 AND lng BETWEEN 77.30 AND 77.90
      AND (name ILIKE ${pattern} OR area ILIKE ${pattern})
    ORDER BY lower(name), area, id LIMIT 21 OFFSET ${offset}`;
  return { restaurants: rows.slice(0, 20).map(localRestaurant), nextOffset: rows.length > 20 ? offset + 20 : null };
}

export async function getRestaurant(id: string): Promise<Restaurant | null> {
  if (id.startsWith("google:")) {
    const placeId = id.slice(7);
    if (!/^[A-Za-z0-9_-]{1,250}$/.test(placeId)) return null;
    const p = await places(`places/${placeId}`, fields);
    return isFood(p.types) && inBangalore(p.location?.latitude, p.location?.longitude) ? googleRestaurant(p) : null;
  }
  if (!id.startsWith("osm:")) return null;
  const rows = await sql()`SELECT id, name, area, lat, lng FROM venues WHERE id = ${id.slice(4)} AND status = 'active'
    AND lat BETWEEN 12.75 AND 13.25 AND lng BETWEEN 77.30 AND 77.90`;
  return rows[0] ? localRestaurant(rows[0]) : null;
}

export async function coverage() {
  const rows = await sql()`SELECT COUNT(*)::int AS count, MAX(updated_at)::text AS updated_at FROM venues
    WHERE status = 'active' AND lat BETWEEN 12.75 AND 13.25 AND lng BETWEEN 77.30 AND 77.90`;
  return { city: "Bengaluru", catalogCount: rows[0].count, catalogUpdatedAt: rows[0].updated_at ? Number(rows[0].updated_at) : null,
    liveSearch: hasPlaces(), complete: false };
}
