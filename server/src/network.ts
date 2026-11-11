/** Vercel overwrites incoming XFF at its edge (see docs/SECURITY_REVIEW.md).
 * Direct/self-hosted Node must not trust forwarded headers by default. Other
 * deployments may opt into explicit proxy IP/CIDR ranges, never trust-all. */
export function proxyTrust(env: Record<string, string | undefined> = process.env): false | number | string[] {
  if (env.VERCEL === "1") return 1;
  const ranges = (env.TRUST_PROXY_CIDRS ?? "").split(",").map(s => s.trim()).filter(Boolean);
  return ranges.length ? ranges : false;
}
export function permittedOrigin(origin: string, env: Record<string, string | undefined> = process.env): boolean {
  const configured = (env.ALLOWED_ORIGINS ?? "").split(",").map(s => s.trim()).filter(Boolean);
  if (configured.includes(origin)) return true;
  return env.NODE_ENV !== "production" && /^https?:\/\/localhost:\d+$/.test(origin);
}
