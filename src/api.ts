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
  user: { id: string; phone: string | null; email?: string | null; role: string };
}

const STORAGE_KEY = "bhookmark.session";

export function getSession(): Session | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  try { return raw ? JSON.parse(raw) : null; } catch { clearSession(); return null; }
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

// The real, free login path (no SMS provider is wired up — see F01 in the
// 2026-09-08 brief). idToken is the credential Google Identity Services
// hands back to the button's callback; verified server-side before any
// session is issued.
export async function signInWithGoogle(idToken: string) {
  const res = await fetch(`${BASE}/auth/google`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken, deviceLabel: navigator.userAgent.split(" ")[0] }),
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
  // JSON unless the caller sends something else (photo uploads send image bytes).
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (session) headers.set("Authorization", `Bearer ${session.accessToken}`);

  let res = await fetch(`${BASE}${path}`, { ...opts, headers });
  if (res.status === 401 && session) {
    const refreshed = await refresh();
    if (refreshed) {
      const retryHeaders = new Headers(opts.headers);
      if (!retryHeaders.has("Content-Type")) retryHeaders.set("Content-Type", "application/json");
      retryHeaders.set("Authorization", `Bearer ${getSession()!.accessToken}`);
      res = await fetch(`${BASE}${path}`, { ...opts, headers: retryHeaders });
    }
  }
  if (res.status === 401) window.dispatchEvent(new Event("bhookmark:session-expired"));
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

async function json<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await api(path, options);
  const body = await response.json();
  if (!response.ok || !body.ok) throw new Error(body.error || "Couldn't complete that request.");
  return body;
}

export async function searchRestaurants(q: string, page?: { source: string; offset?: number; pageToken?: string }, signal?: AbortSignal) {
  const query = new URLSearchParams({ q });
  if (page) {
    query.set("source", page.source);
    if (page.offset !== undefined) query.set("offset", String(page.offset));
    if (page.pageToken) query.set("pageToken", page.pageToken);
  }
  return json<import("./wishlist").SearchResult>(`/restaurants/search?${query}`, { signal });
}
export async function getRestaurant(id: string) {
  return (await json<{ restaurant: import("./wishlist").Restaurant }>(`/restaurants/${encodeURIComponent(id)}`)).restaurant;
}
export function getCoverage() {
  return json<{ catalogCount: number; catalogUpdatedAt: number | null; liveSearch: boolean; complete: false }>("/restaurants/coverage");
}
export async function getBookmarks() {
  return (await json<{ bookmarks: import("./wishlist").Bookmark[] }>("/bookmarks")).bookmarks;
}
export async function putBookmark(input: import("./wishlist").BookmarkInput, id?: string) {
  return (await json<{ bookmark: import("./wishlist").Bookmark }>(id ? `/bookmarks/${encodeURIComponent(id)}` : "/bookmarks", { method: id ? "PATCH" : "POST", body: JSON.stringify(input) })).bookmark;
}
export async function removeBookmark(id: string) {
  await json(`/bookmarks/${encodeURIComponent(id)}`, { method: "DELETE" });
}
