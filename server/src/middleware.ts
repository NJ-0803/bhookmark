import type { NextFunction, Request, Response } from "express";
import { verifyAccessToken, AccessPayload } from "./auth";
import { Role } from "./db";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AccessPayload;
    }
  }
}

/** A05/A07 mitigation: every protected route verifies the token server-side
 * on every request — deny by default, never trust a client-asserted role. */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ ok: false, error: "Sign in required." });
  }
  try {
    req.user = verifyAccessToken(header.slice(7));
    next();
  } catch {
    return res.status(401).json({ ok: false, error: "Session expired. Sign in again." });
  }
}

/** Like requireAuth, but for routes that must work for anonymous browsing too
 * (e.g. a public dish score) while still personalizing when a valid session
 * is present. An invalid/expired token is treated as anonymous, not an error. */
export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) {
    try {
      req.user = verifyAccessToken(header.slice(7));
    } catch {
      // fall through as anonymous
    }
  }
  next();
}

/** Deny-by-default role check (A07). */
export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ ok: false, error: "Not allowed." });
    }
    next();
  };
}

/** Section 14: sensitive actions (changing phone, deleting account, moderator
 * actions) require the session to be freshly authenticated, not just valid. */
export function requireRecentAuth(maxAgeSeconds: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const age = Date.now() / 1000 - (req.user?.authTime ?? 0);
    if (age > maxAgeSeconds) {
      return res.status(401).json({ ok: false, error: "reauth_required", maxAgeSeconds });
    }
    next();
  };
}
