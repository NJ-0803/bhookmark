import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import type { Request } from "express";

// Extracted so the exact same limiter config can be exercised both by the
// real app (index.ts) and by an isolated test harness (scripts/ip-isolation-test.ts)
// without the two drifting apart.
export function createGlobalLimiter() {
  return rateLimit({
    windowMs: 60 * 1000,
    limit: 300,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req: Request) => {
      const auth = req.headers.authorization;
      return auth ? `session:${auth}` : `ip:${ipKeyGenerator(req.ip ?? "")}`;
    },
    skip: (req: Request) => req.method === "GET" && (req.path.startsWith("/dishes") || req.path.startsWith("/venues")),
  });
}
