import express from "express";
import cors from "cors";
import helmet from "helmet";
import { createGlobalLimiter } from "./globalRateLimit";
import { authRouter } from "./routes/auth";
import { createBookmarksRouter } from "./routes/bookmarks";
import { restaurantsRouter } from "./routes/restaurants";

const app = express();

// Real production fix: this app has been deployed behind Vercel's edge
// network for a while now, but this flag was never set — meaning req.ip
// (and every IP-keyed rate limit/abuse signal built on it, including the
// multi-account-per-network check below) was reading Vercel's internal
// proxy IP, not the real client. Safe to trust unconditionally here
// specifically because a Vercel serverless function has no other public
// network path — every request genuinely did pass through Vercel's own
// proxy first. This would NOT be safe on infrastructure with an
// attacker-reachable path that bypasses the trusted proxy.
app.set("trust proxy", true);

app.use(helmet());
// In production, the frontend and API are served from the same Vercel
// domain via rewrites (see vercel.json) — this only needs to cover local
// dev (Vite's own dev server) and Vercel's preview-deployment domains,
// not an open wildcard.
app.use(
  cors({
    origin: [/^http:\/\/localhost:\d+$/, /^https:\/\/localhost:\d+$/, /\.vercel\.app$/],
  })
);
app.use(express.json({ limit: "1mb" }));

// Authenticated traffic is limited per verified user; anonymous requests
// fall back to IP. Restaurant requests have an additional route limit.
app.use(createGlobalLimiter());

app.get("/health", (_req, res) => res.json({ ok: true }));
app.use("/auth", authRouter);
app.use("/bookmarks", createBookmarksRouter());
app.use("/restaurants", restaurantsRouter);
app.use((_req, res) => res.status(404).json({ ok: false, error: "Not found." }));
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (error instanceof SyntaxError) return res.status(400).json({ ok: false, error: "Invalid request." });
  console.error("[api] Request failed", error instanceof Error ? error.name : "Unknown error");
  return res.status(503).json({ ok: false, error: "Couldn't complete that request. Please try again." });
});

export default app;
