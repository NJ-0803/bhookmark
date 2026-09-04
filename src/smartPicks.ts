import type { Category } from "./types";
import { CATEGORIES } from "./data/dishes";

// Real geography + real live weather, never a fabricated "AI" claim. Both
// calls are free/keyless (OpenStreetMap Nominatim, Open-Meteo) which is fine
// at this app's current scale — a real production volume would need a paid
// geocoding provider and server-side caching instead of calling Nominatim
// directly from the client (see the implementation notes on this feature).
//
// Festivals were explicitly left out: lunar-calendar festival dates shift
// every year and hardcoding specific 2026 dates from memory risks stating a
// wrong date as fact — exactly the kind of fabricated-confidence bug this
// app has spent this whole session removing elsewhere. Add a real festival
// calendar API (or confirm exact dates) before building that half.

const REGION_PRIORITY: { country?: string; cityIncludes?: string[]; order: Category[]; label: string }[] = [
  { country: "Nepal", order: ["Momos", "Dosa & Idli", "Biryani", "Filter Coffee", "Burger", "Pizza"], label: "Nepal" },
  { country: "India", cityIncludes: ["bengaluru", "bangalore"], order: ["Dosa & Idli", "Filter Coffee", "Biryani", "Momos", "Burger", "Pizza"], label: "Bengaluru" },
  { country: "India", cityIncludes: ["hyderabad"], order: ["Biryani", "Dosa & Idli", "Filter Coffee", "Momos", "Burger", "Pizza"], label: "Hyderabad" },
  { country: "India", cityIncludes: ["delhi"], order: ["Momos", "Burger", "Biryani", "Dosa & Idli", "Pizza", "Filter Coffee"], label: "Delhi" },
  { country: "India", cityIncludes: ["mumbai"], order: ["Burger", "Biryani", "Pizza", "Dosa & Idli", "Momos", "Filter Coffee"], label: "Mumbai" },
];

function reorderByPriority(order: Category[]): Category[] {
  const known = CATEGORIES.map((c) => c.name);
  const prioritized = order.filter((c) => known.includes(c));
  const rest = known.filter((c) => !prioritized.includes(c));
  return [...prioritized, ...rest];
}

function regionPriority(country: string, city: string): { categories: Category[]; label: string } | null {
  const cityLower = city.toLowerCase();
  const match = REGION_PRIORITY.find(
    (r) =>
      (!r.country || r.country.toLowerCase() === country.toLowerCase()) &&
      (!r.cityIncludes || r.cityIncludes.some((c) => cityLower.includes(c)))
  );
  return match ? { categories: reorderByPriority(match.order), label: match.label } : null;
}

interface WeatherContext {
  tempC: number;
  isRaining: boolean;
  isHot: boolean;
  isCold: boolean;
}

async function fetchWeather(lat: number, lng: number): Promise<WeatherContext | null> {
  try {
    const res = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,precipitation,weather_code`
    );
    if (!res.ok) return null;
    const data = await res.json();
    const tempC = data?.current?.temperature_2m;
    if (typeof tempC !== "number") return null;
    const precipitation = data?.current?.precipitation ?? 0;
    const code = data?.current?.weather_code ?? 0;
    // WMO weather codes: 51-67 drizzle/rain, 80-82 rain showers, 95-99 thunderstorm.
    const isRaining = precipitation > 0 || (code >= 51 && code <= 82) || code >= 95;
    return { tempC, isRaining, isHot: tempC >= 32, isCold: tempC <= 18 };
  } catch {
    return null;
  }
}

function weatherNudge(weather: WeatherContext): { category: Category; reason: string } | null {
  const t = Math.round(weather.tempC);
  if (weather.isRaining) return { category: "Filter Coffee", reason: `Raining and ${t}°C right now — hot filter coffee weather.` };
  if (weather.isCold) return { category: "Biryani", reason: `A cool ${t}°C out — something hot and hearty hits different.` };
  if (weather.isHot) return { category: "Filter Coffee", reason: `${t}°C right now — iced filter coffee, obviously.` };
  return null;
}

async function reverseGeocode(lat: number, lng: number): Promise<{ country: string; city: string; area: string | null } | null> {
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`, {
      headers: { "Accept-Language": "en" },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const addr = data?.address ?? {};
    const country: string = addr.country ?? "";
    const city: string = addr.city ?? addr.town ?? addr.state_district ?? addr.state ?? "";
    // Neighborhood-level, when Nominatim has it — real data only, never a
    // fabricated distance or made-up locality (this app doesn't guess).
    const area: string | null = addr.suburb ?? addr.neighbourhood ?? addr.city_district ?? null;
    return country ? { country, city, area } : null;
  } catch {
    return null;
  }
}

export interface SmartOrderResult {
  categories: Category[];
  reasons: string[];
  /** Real resolved area/city for a location pill — never a distance, since
   * nothing here is anchored to one venue yet to measure distance against. */
  area: string | null;
  /** Real live weather condition, when resolved, for a contextual UI accent
   * (e.g. a rain/heat emoji) — never fabricated when weather lookup fails. */
  weatherMood: "rain" | "hot" | "cold" | null;
}

/** Real, best-effort personalization from where you actually are and what
 * the weather is actually doing right now — never a guess dressed up as AI.
 * Either signal can silently fail (no network, denied precision, vendor
 * down) without breaking anything; the caller falls back to the default
 * category order. */
export async function computeSmartOrder(lat: number, lng: number): Promise<SmartOrderResult | null> {
  const [geo, weather] = await Promise.all([reverseGeocode(lat, lng), fetchWeather(lat, lng)]);
  if (!geo && !weather) return null;

  let categories = CATEGORIES.map((c) => c.name);
  const reasons: string[] = [];
  const area = geo ? geo.area ?? geo.city ?? null : null;
  const weatherMood = weather ? (weather.isRaining ? "rain" : weather.isHot ? "hot" : weather.isCold ? "cold" : null) : null;

  if (geo) {
    const region = regionPriority(geo.country, geo.city);
    if (region) {
      categories = region.categories;
      reasons.push(`📍 ${region.label} favorites, bumped up first`);
    }
  }

  if (weather) {
    const nudge = weatherNudge(weather);
    if (nudge) {
      categories = [nudge.category, ...categories.filter((c) => c !== nudge.category)];
      reasons.push(`🌦️ ${nudge.reason}`);
    }
  }

  return reasons.length > 0 ? { categories, reasons, area, weatherMood } : null;
}
