import Constants from 'expo-constants';

// Where the app talks to.
// - Development (Expo Go / dev client): the Mac running Metro also runs the
//   local API (`npm run dev` in server/, Neon test branch) on this port, so
//   the host is taken from Metro's own address. Real users' data is never
//   touched from a development build.
// - Release builds: the production API behind bhookmark.com.
// EXPO_PUBLIC_API_URL overrides both (e.g. a Vercel preview).
const LOCAL_API_PORT = 4001;
export const WEB_ORIGIN = 'https://bhookmark.com';

function metroHost(): string | null {
  const hostUri = Constants.expoConfig?.hostUri; // e.g. "172.20.10.3:8081"
  return hostUri ? hostUri.split(':')[0] : null;
}

function resolveApiBase(): string {
  const override = process.env.EXPO_PUBLIC_API_URL;
  if (override) return override.replace(/\/$/, '');
  const host = __DEV__ ? metroHost() : null;
  return host ? `http://${host}:${LOCAL_API_PORT}` : WEB_ORIGIN;
}

export const API_BASE = resolveApiBase();

/** True when requests go to the local test-branch API rather than production. */
export const USING_LOCAL_API = API_BASE !== WEB_ORIGIN;

/** Catalog photos are site-relative on the web ("/dishes/d1.jpg"); uploaded ones are absolute. */
export function absoluteUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (/^https?:\/\//.test(path)) return path;
  return `${WEB_ORIGIN}${path.startsWith('/') ? '' : '/'}${path}`;
}
