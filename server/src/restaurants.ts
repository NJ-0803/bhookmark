import { sql } from "./bookmarks";
import { restaurantDirectory } from "./restaurantDirectory";

// Per-city search regions, not completeness claims. The Bengaluru boundary
// includes the suburbs omitted by the old 12.90..13.02 seed import.
export interface City { key: string; label: string; low: { latitude: number; longitude: number }; high: { latitude: number; longitude: number } }
export const CITIES: Record<string, City> = {
  bengaluru: { key: "bengaluru", label: "Bengaluru", low: { latitude: 12.75, longitude: 77.30 }, high: { latitude: 13.25, longitude: 77.90 } },
  patiala: { key: "patiala", label: "Patiala", low: { latitude: 30.25, longitude: 76.30 }, high: { latitude: 30.45, longitude: 76.50 } },
};
export const DEFAULT_CITY = "bengaluru";
export const cityByKey = (key?: string | null): City => CITIES[String(key ?? "")] ?? CITIES[DEFAULT_CITY];
// Historical export kept for callers that still name the metro boundary.
export const BANGALORE = { low: { ...CITIES.bengaluru.low }, high: { ...CITIES.bengaluru.high } };
export interface RestaurantPhoto {
  url: string;
  sourceUrl: string;
  authors: { name: string; url: string }[];
  provider?: string;
  license?: { name: string; url: string };
  year?: number;
  description?: string;
}
export interface Restaurant {
  id: string; name: string; address: string; lat: number; lng: number; city: string;
  source: "google" | "osm"; mapsUrl: string; photos: RestaurantPhoto[];
  attributions?: { provider: string; providerUri: string }[];
  featured?: boolean; category?: string; identitySource?: string; ratingCount?: number;
}
export class PlacesUnavailable extends Error {}
export const hasPlaces = () => Boolean(process.env.GOOGLE_PLACES_API_KEY);
const fields = "id,displayName,formattedAddress,location,photos,googleMapsUri,attributions,types";
const foodTypes = new Set(["restaurant", "cafe", "bakery", "bar", "meal_takeaway", "meal_delivery", "food_court", "ice_cream_shop", "coffee_shop", "pub"]);
const isFood = (types: string[] = []) => types.some((type) => foodTypes.has(type) || type.endsWith("_restaurant"));
const inCity = (city: City, lat: number, lng: number) => Number.isFinite(lat) && Number.isFinite(lng) && lat >= city.low.latitude && lat <= city.high.latitude && lng >= city.low.longitude && lng <= city.high.longitude;
const inAnyCity = (lat: number, lng: number) => Object.values(CITIES).some((city) => inCity(city, lat, lng));

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

function googleRestaurant(p: any, city: City): Restaurant {
  const mapsUrl = p.googleMapsUri || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.displayName?.text || "Restaurant")}&query_place_id=${encodeURIComponent(p.id)}`;
  return { id: `google:${p.id}`, name: p.displayName?.text ?? "Restaurant", address: p.formattedAddress || city.label,
    lat: p.location?.latitude, lng: p.location?.longitude, city: city.label, source: "google", mapsUrl,
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

export async function searchGoogle(q: string, cityKey: string = DEFAULT_CITY, pageToken?: string) {
  const city = cityByKey(cityKey);
  const result = await places("places:searchText", fields.split(",").map((f) => `places.${f}`).join(",") + ",nextPageToken", {
    textQuery: `${q || "restaurants cafes bakeries"} in ${city.label}`, pageSize: 20,
    locationRestriction: { rectangle: { low: city.low, high: city.high } }, ...(pageToken ? { pageToken } : {}),
  });
  // Strict city isolation: results outside the selected city's region are dropped.
  return { restaurants: (result.places ?? []).filter((p: any) => isFood(p.types) && inCity(city, p.location?.latitude, p.location?.longitude)).map((p: any) => googleRestaurant(p, city)), nextPageToken: result.nextPageToken ?? null };
}

function localRestaurant(v: Record<string, any>): Restaurant {
  // Photos belong to a reviewed OSM branch, never a fuzzy chain-name match.
  const verified = restaurantDirectory[v.osm_id];
  const cityLabel = String(v.city || CITIES[DEFAULT_CITY].label);
  const area = String(v.area || "").trim();
  const address = !area || /^(bengaluru|bangalore)$/i.test(area) ? cityLabel : new RegExp(`(?:${cityLabel})$`, "i").test(area) ? area : `${area}, ${cityLabel}`;
  return { id: `osm:${v.id}`, name: verified?.name ?? v.name, address: verified?.address ?? address, lat: v.lat, lng: v.lng, city: cityLabel,
    source: "osm", mapsUrl: `https://www.google.com/maps/search/?api=1&query=${v.lat},${v.lng}`,
    photos: verified?.photo ? [verified.photo] : [],
    featured: verified?.featuredRank !== undefined, category: verified?.category, identitySource: verified?.identitySource,
    ratingCount: Number(v.rating_count || 0) };
}

export async function searchLocal(q: string, cityKey: string = DEFAULT_CITY, offset = 0, connect: typeof sql = sql) {
  const city = cityByKey(cityKey);
  const db = connect();
  const pattern = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
  const featured = Object.entries(restaurantDirectory).filter(([, v]) => v.featuredRank !== undefined).sort((a, b) => a[1].featuredRank! - b[1].featuredRank!).map(([id]) => id);
  const aliases = Object.entries(restaurantDirectory).filter(([, v]) => `${v.name} ${v.address} ${v.aliases}`.toLowerCase().includes(q.toLowerCase())).map(([id]) => id);
  // One person counts once per branch, regardless of how many dishes they rate.
  // Publish only the count, never private scores, notes or user identities.
  // Strict city isolation: both the stored city and the coordinate region must match.
  const rows = await db`WITH ratings AS (
      SELECT restaurant_id, COUNT(DISTINCT user_id)::int AS rating_count FROM food_bookmarks
      WHERE tried AND rating IS NOT NULL GROUP BY restaurant_id
    )
    SELECT v.id, v.osm_id, v.name, v.area, v.city, v.lat, v.lng, COALESCE(r.rating_count, 0) AS rating_count
    FROM venues v LEFT JOIN ratings r ON r.restaurant_id = 'osm:' || v.id
    WHERE status = 'active' AND city = ${city.label}
      AND lat BETWEEN ${city.low.latitude} AND ${city.high.latitude} AND lng BETWEEN ${city.low.longitude} AND ${city.high.longitude}
      AND (name ILIKE ${pattern} OR area ILIKE ${pattern} OR osm_id = ANY(${aliases}::text[]))
    ORDER BY CASE WHEN COALESCE(r.rating_count, 0) >= 3 THEN 0 ELSE 1 END,
      CASE WHEN COALESCE(r.rating_count, 0) >= 3 THEN r.rating_count ELSE 0 END DESC,
      COALESCE(array_position(${featured}::text[], osm_id), 1000), COALESCE(r.rating_count, 0) DESC,
      CASE WHEN ${q} = '' AND name ~ '^[0-9]' THEN 1 ELSE 0 END, lower(name), area, v.id LIMIT 21 OFFSET ${offset}`;
  return { restaurants: rows.slice(0, 20).map(localRestaurant), nextOffset: rows.length > 20 ? offset + 20 : null };
}

export async function getRestaurant(id: string, connect: typeof sql = sql): Promise<Restaurant | null> {
  if (id.startsWith("google:")) {
    const placeId = id.slice(7);
    if (!/^[A-Za-z0-9_-]{1,250}$/.test(placeId)) return null;
    const p = await places(`places/${placeId}`, fields);
    if (!isFood(p.types) || !inAnyCity(p.location?.latitude, p.location?.longitude)) return null;
    const city = Object.values(CITIES).find((c) => inCity(c, p.location?.latitude, p.location?.longitude)) ?? CITIES[DEFAULT_CITY];
    return googleRestaurant(p, city);
  }
  if (!id.startsWith("osm:")) return null;
  const rows = await connect()`SELECT id, osm_id, name, area, city, lat, lng,
    (SELECT COUNT(DISTINCT user_id)::int FROM food_bookmarks WHERE restaurant_id = 'osm:' || v.id AND tried AND rating IS NOT NULL) AS rating_count
    FROM venues v WHERE id = ${id.slice(4)} AND status = 'active'`;
  if (!rows[0] || !inAnyCity(rows[0].lat, rows[0].lng)) return null;
  return localRestaurant(rows[0]);
}

export async function coverage(cityKey: string = DEFAULT_CITY, connect: typeof sql = sql) {
  const city = cityByKey(cityKey);
  const rows = await connect()`SELECT COUNT(*)::int AS count, MAX(updated_at)::text AS updated_at FROM venues
    WHERE status = 'active' AND city = ${city.label}
      AND lat BETWEEN ${city.low.latitude} AND ${city.high.latitude} AND lng BETWEEN ${city.low.longitude} AND ${city.high.longitude}`;
  return { city: city.label, cityKey: city.key, cities: Object.values(CITIES).map((c) => ({ key: c.key, label: c.label })),
    catalogCount: rows[0].count, catalogUpdatedAt: rows[0].updated_at ? Number(rows[0].updated_at) : null,
    liveSearch: hasPlaces(), complete: false };
}
