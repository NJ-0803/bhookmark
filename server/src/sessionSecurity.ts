export function verifiedGoogleIdentity(payload: { sub?: string; email?: string; email_verified?: boolean } | undefined) {
  if (!payload?.sub || !payload.email || payload.email_verified !== true) throw new Error("Incomplete or unverified Google identity");
  return { sub: payload.sub, email: payload.email };
}

/** All stale credentials are rejected. A short post-rotation grace only
 * suppresses family revocation for overlapping requests/lost responses. It
 * never exchanges a stale token for a new one. After the grace, revoke on replay. */
export function refreshDisposition(family: { currentJti: string; rotatedAt?: number | null }, jti: string, now = Date.now()): "current" | "conflict" | "replay" {
  if (family.currentJti === jti) return "current";
  if (family.rotatedAt != null && now >= family.rotatedAt && now - family.rotatedAt < 30_000) return "conflict";
  return "replay";
}
