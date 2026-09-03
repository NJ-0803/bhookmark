// Relative — Vite's dev server proxies these paths to the backend (see
// vite.config.ts), so the browser only ever talks to one HTTPS origin. That
// matters beyond CORS: a secure context is required for navigator.geolocation
// and the Push API to work at all on a phone, and "http://<lan-ip>" doesn't
// qualify — only "https://" or "localhost" do.
const BASE = "";

interface Session {
  accessToken: string;
  refreshToken: string;
  deviceId: string;
  user: { id: string; phone: string; role: string };
}

const STORAGE_KEY = "palate.session";

export function getSession(): Session | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw ? JSON.parse(raw) : null;
}

function saveSession(session: Session) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function clearSession() {
  localStorage.removeItem(STORAGE_KEY);
}

export async function requestOtp(phone: string) {
  const res = await fetch(`${BASE}/auth/otp/request`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone }),
  });
  return res.json();
}

export async function verifyOtp(phone: string, otp: string) {
  const res = await fetch(`${BASE}/auth/otp/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone, otp, deviceLabel: navigator.userAgent.split(" ")[0] }),
  });
  const body = await res.json();
  if (body.ok) {
    saveSession({ accessToken: body.accessToken, refreshToken: body.refreshToken, deviceId: body.deviceId, user: body.user });
  }
  return body;
}

// Single-flight guard: found via real usage testing — Home fires several
// authenticated requests in parallel on mount (recommendations, digest,
// diet profile). If the access token had just expired, each one hit a 401
// and independently called refresh() with the SAME stale refresh token
// still in localStorage. The first refresh to land rotated it server-side;
// every other concurrent call then presented an already-consumed token,
// which the server correctly treats as reuse and revokes the whole session
// — a false-positive lockout from the app's own concurrency, not an attack.
// Sharing one in-flight promise means concurrent 401s trigger exactly one
// network call to /auth/refresh, and everyone waits on that same result.
let refreshPromise: Promise<boolean> | null = null;

async function refresh(): Promise<boolean> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    const session = getSession();
    if (!session) return false;
    const res = await fetch(`${BASE}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: session.refreshToken }),
    });
    const body = await res.json();
    if (!body.ok) {
      clearSession();
      return false;
    }
    saveSession({ ...session, accessToken: body.accessToken, refreshToken: body.refreshToken });
    return true;
  })();
  try {
    return await refreshPromise;
  } finally {
    refreshPromise = null;
  }
}

/** Authenticated fetch that transparently retries once after a token refresh. */
export async function api(path: string, opts: RequestInit = {}) {
  const session = getSession();
  const headers = new Headers(opts.headers);
  headers.set("Content-Type", "application/json");
  if (session) headers.set("Authorization", `Bearer ${session.accessToken}`);

  let res = await fetch(`${BASE}${path}`, { ...opts, headers });
  if (res.status === 401 && session) {
    const refreshed = await refresh();
    if (refreshed) {
      const retryHeaders = new Headers(opts.headers);
      retryHeaders.set("Content-Type", "application/json");
      retryHeaders.set("Authorization", `Bearer ${getSession()!.accessToken}`);
      res = await fetch(`${BASE}${path}`, { ...opts, headers: retryHeaders });
    }
  }
  return res;
}

export async function listSessions() {
  const res = await api("/auth/sessions");
  return res.json();
}

export async function revokeSession(deviceId: string) {
  const res = await api(`/auth/sessions/${deviceId}`, { method: "DELETE" });
  return res.json();
}

export function currentDeviceId(): string | null {
  return getSession()?.deviceId ?? null;
}

export async function getDietProfile() {
  return (await api("/profile")).json();
}

export async function setDietProfile(dietaryProfile: string, allergens: string[]) {
  const res = await api("/profile/diet", { method: "PATCH", body: JSON.stringify({ dietaryProfile, allergens }) });
  return res.json();
}

export async function getNextPicks() {
  return (await api("/recommendations/next")).json();
}

export async function getDigest() {
  return (await api("/recommendations/digest")).json();
}

export interface RemoteLog {
  id: string;
  category: string;
  subtype: string;
  name: string;
  venue: string;
  verdict: "loved" | "fine" | "not-for-me";
  score: number;
  note: string;
  verified: boolean;
  status: "published" | "held" | "removed";
  createdAt: number;
}

export async function getMyLogs(): Promise<{ ok: boolean; logs: RemoteLog[]; error?: string }> {
  const res = await api("/logs/mine");
  return res.json();
}

export interface NearbyVenue {
  id: string;
  name: string;
  area: string;
  distanceKm: number;
  photo: string;
  photoIsVerified: boolean;
  dishName: string;
  rating: number;
  ratingSource: "community" | "baseline";
  reviewCount: number;
  reviews: { verdict: string; note: string; score: number; createdAt: number }[];
}

export interface DishScoreResponse {
  ok: boolean;
  community: { score: number | null; count: number };
  verifiedOnly: { score: number | null; count: number };
  yours: { score: number; verdict: string } | null;
  confidenceBand: "insufficient" | "early" | "developing" | "strong";
  error?: string;
}

// Score separation (brief 1.2): Your / Community / Verified-only are always
// distinct numbers with real sample sizes, never blended into one figure.
// Unauthenticated on purpose (optionalAuth server-side) — browsing a dish
// score shouldn't require signing in, but a session personalizes "yours".
export async function getDishScore(venue: string, category: string, subtype: string, name: string): Promise<DishScoreResponse> {
  const params = new URLSearchParams({ venue, category, subtype, name });
  const res = await api(`/dishes/score?${params}`);
  return res.json();
}

export async function getNearbyVenues(category: string, lat: number, lng: number, radiusKm = 5) {
  const params = new URLSearchParams({ category, lat: String(lat), lng: String(lng), radiusKm: String(radiusKm) });
  // Unauthenticated on purpose — browsing nearby joints shouldn't require signing in first,
  // and the query carries no persistent identity (see server/src/routes/venues.ts).
  const res = await fetch(`/venues/nearby?${params}`);
  return res.json() as Promise<{ ok: boolean; category: string; radiusKm: number; count: number; results: NearbyVenue[]; error?: string }>;
}
