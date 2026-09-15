import { Platform } from 'react-native';
import { API_BASE } from './config';
import { clearStoredSession, loadStoredSession, storeSession, type Session } from './session';

// Native port of the web app's src/api.ts for the Step 4 journey (sign in,
// discover, save, log, journal). Same endpoints and response shapes; storage
// is the platform keystore, and every request has a timeout so a slow or
// dead network can't freeze the interface.

const TIMEOUT_MS = 15000;
const NETWORK_ERROR = "Can't reach Bhookmark right now. Check your connection and try again.";

// ---------- session ----------

let current: Session | null = null;
const listeners = new Set<(session: Session | null) => void>();

export function getSession(): Session | null {
  return current;
}

export async function restoreSession(): Promise<Session | null> {
  current = await loadStoredSession();
  return current;
}

export function onSessionChange(listener: (session: Session | null) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

async function setSession(next: Session | null) {
  current = next;
  if (next) await storeSession(next);
  else await clearStoredSession();
  listeners.forEach((l) => l(next));
}

// ---------- transport ----------

type RequestOptions = { method?: string; body?: unknown; headers?: Record<string, string> };

async function send(path: string, opts: RequestOptions, accessToken?: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...opts.headers };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  try {
    return await fetch(`${API_BASE}${path}`, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

// Single-flight refresh, as on the web: several requests hitting a 401 at
// once must share one /auth/refresh call, or the second rotation presents an
// already-used refresh token and the server revokes the whole session.
let refreshing: Promise<boolean> | null = null;

async function refresh(): Promise<boolean> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const session = current;
    if (!session) return false;
    try {
      const res = await send('/auth/refresh', { method: 'POST', body: { refreshToken: session.refreshToken } });
      const body = await res.json();
      if (!body.ok) {
        await setSession(null);
        return false;
      }
      await setSession({ ...session, accessToken: body.accessToken, refreshToken: body.refreshToken });
      return true;
    } catch {
      // Network failure: keep the session; the caller reports the error.
      return false;
    }
  })();
  try {
    return await refreshing;
  } finally {
    refreshing = null;
  }
}

type Failure = { ok: false; error: string };

async function call<T extends { ok: boolean }>(path: string, opts: RequestOptions = {}, auth = true): Promise<T | Failure> {
  try {
    let res = await send(path, opts, auth ? current?.accessToken : undefined);
    if (auth && res.status === 401 && current) {
      if (await refresh()) res = await send(path, opts, current?.accessToken);
    }
    try {
      return (await res.json()) as T;
    } catch {
      return { ok: false, error: `Unexpected response from the server (${res.status}).` };
    }
  } catch {
    return { ok: false, error: NETWORK_ERROR };
  }
}

// ---------- auth ----------

const deviceLabel = `Bhookmark ${Platform.OS === 'ios' ? 'iOS' : 'Android'} app`;

export async function requestOtp(phone: string) {
  return call<{ ok: boolean; devOtp?: string; smsUnavailable?: boolean; error?: string }>(
    '/auth/otp/request',
    { method: 'POST', body: { phone } },
    false,
  );
}

export async function verifyOtp(phone: string, otp: string) {
  const body = await call<{ ok: boolean; error?: string } & Partial<Session>>(
    '/auth/otp/verify',
    { method: 'POST', body: { phone, otp, deviceLabel } },
    false,
  );
  if (body.ok && 'accessToken' in body && body.accessToken && body.refreshToken && body.deviceId && body.user) {
    await setSession({ accessToken: body.accessToken, refreshToken: body.refreshToken, deviceId: body.deviceId, user: body.user });
  }
  return body;
}

/** Revokes this device's session server-side (best effort), then forgets it locally. */
export async function signOut(): Promise<void> {
  const session = current;
  if (session) await call(`/auth/sessions/${encodeURIComponent(session.deviceId)}`, { method: 'DELETE' });
  await setSession(null);
}

// ---------- discovery ----------

export interface BrowseDish {
  id: string;
  category: string;
  subtype: string;
  name: string;
  venue: string;
  area: string;
  photo: string | null;
  community: { score: number | null; count: number };
}

export interface VenueSearchResult {
  id: string;
  name: string;
  area: string;
  category: string | null;
  subtype: string | null;
  dishName: string | null;
  photo: string | null;
  photoIsVerified: boolean;
  distanceKm: number | null;
}

export interface DishScoreResponse {
  ok: boolean;
  photos: { logId: string; url: string; createdAt: number }[];
  community: { score: number | null; count: number };
  verifiedOnly: { score: number | null; count: number };
  yours: { score: number; verdict: string } | null;
  confidenceBand: 'insufficient' | 'early' | 'developing' | 'strong';
  notes: { verdict: string; note: string; score: number; createdAt: number }[];
  error?: string;
}

export function getVenueCategories() {
  return call<{ ok: boolean; categories: string[]; error?: string }>('/venues/categories', {}, false);
}

export function browseDishes(category: string) {
  return call<{ ok: boolean; category: string; categoryResolved: boolean; count: number; results: BrowseDish[]; error?: string }>(
    `/dishes/browse?category=${encodeURIComponent(category)}`,
    {},
    false,
  );
}

export function searchVenues(query: string) {
  return call<{ ok: boolean; count: number; results: VenueSearchResult[]; error?: string }>(
    `/venues/search?q=${encodeURIComponent(query)}`,
    {},
    false,
  );
}

export function getDishScore(venue: string, category: string, subtype: string, name: string) {
  const q = [
    ['venue', venue],
    ['category', category],
    ['subtype', subtype],
    ['name', name],
  ]
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');
  return call<DishScoreResponse>(`/dishes/score?${q}`);
}

// ---------- saves ----------

export interface SavedDish {
  name: string;
  venue: string;
  area: string;
  category: string;
  subtype: string;
  savedAt: number;
}

export function getSaves() {
  return call<{ ok: boolean; saves: SavedDish[]; error?: string }>('/saves');
}

export function saveDish(dish: Omit<SavedDish, 'savedAt'>) {
  return call<{ ok: boolean; save?: SavedDish; created?: boolean; error?: string }>('/saves', { method: 'POST', body: dish });
}

export function unsaveDish(name: string, venue: string) {
  return call<{ ok: boolean; removed?: boolean; error?: string }>('/saves', { method: 'DELETE', body: { name, venue } });
}

// ---------- logs ----------

export type Verdict = 'loved' | 'fine' | 'not-for-me';

export interface RemoteLog {
  id: string;
  category: string;
  subtype: string;
  name: string;
  venue: string;
  verdict: Verdict;
  score: number;
  note: string;
  verified: boolean;
  status: 'published' | 'held' | 'removed';
  createdAt: number;
  ownerDisclosed?: boolean;
  visibility?: 'private' | 'public';
  visitId?: string | null;
  photoUrl?: string | null;
}

export interface CreateLogPayload {
  category: string;
  subtype: string;
  name: string;
  venue: string;
  verdict: Verdict;
  score: number;
  note: string;
  visibility: 'private' | 'public';
  visitId?: string;
  evidence: { livePhoto: boolean; receipt: boolean; location: { lat: number; lng: number } | null };
}

export function createLog(payload: CreateLogPayload, idempotencyKey: string) {
  return call<{ ok: boolean; log?: RemoteLog; error?: string }>('/logs', {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: { ...payload, deviceId: current?.deviceId ?? 'unknown-device' },
  });
}

export function getMyLogs() {
  return call<{ ok: boolean; logs: RemoteLog[]; error?: string }>('/logs/mine');
}
