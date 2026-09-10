import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import type { Request } from "express";
import { verifyAccessToken } from "./auth";

// Extracted so the exact same limiter config can be exercised both by the
// real app (index.ts) and by an isolated test harness (scripts/ip-isolation-test.ts)
// without the two drifting apart.
export function createGlobalLimiter() {
  return rateLimit({
    windowMs: 60 * 1000,
    limit: 300,
    standardHeaders: true,
    legacyHeaders: false,
    // F07 (implementation brief, 2026-09-08): this used to key by the raw
    // Authorization header string. That means ANY caller can dodge the
    // limiter for free — an invalid, expired or entirely made-up bearer
    // token still produces a fresh, never-seen-before key every request,
    // so it never accumulates against a bucket. Only a token that actually
    // verifies gets bucketed by identity; anything else (missing, expired,
    // forged) falls back to IP, same as a signed-out caller.
    keyGenerator: (req: Request) => {
      const auth = req.headers.authorization;
      if (auth?.startsWith("Bearer ")) {
        try {
          const payload = verifyAccessToken(auth.slice(7));
          return `user:${payload.sub}`;
        } catch {
          // falls through to IP — an invalid token is not a distinct identity
        }
      }
      return `ip:${ipKeyGenerator(req.ip ?? "")}`;
    },
    skip: (req: Request) => req.method === "GET" && (req.path.startsWith("/dishes") || req.path.startsWith("/venues")),
  });
}
