// VAPID keys come from environment variables in every environment now —
// generate your own with `npx web-push generate-vapid-keys` and set
// VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY (locally in server/.env, and in
// Vercel via `vercel env add`). Never commit real keys to source.
function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name}`);
  return v;
}

export const VAPID_PUBLIC_KEY = requireEnv("VAPID_PUBLIC_KEY");
export const VAPID_PRIVATE_KEY = requireEnv("VAPID_PRIVATE_KEY");
