import express from "express";
import cors from "cors";
import helmet from "helmet";
import { createGlobalLimiter } from "./globalRateLimit";
import { authRouter } from "./routes/auth";
import { logsRouter } from "./routes/logs";
import { dishesRouter } from "./routes/dishes";
import { moderationRouter } from "./routes/moderation";
import { devRouter } from "./routes/dev";
import { profileRouter } from "./routes/profile";
import { recommendationsRouter } from "./routes/recommendations";
import { venuesRouter } from "./routes/venues";
import { notificationsRouter } from "./routes/notifications";

const app = express();
const isProd = process.env.NODE_ENV === "production";

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

// A13/global abuse floor: defense in depth behind the endpoint-specific
// limiters in routes/auth.ts. Found by an actual 100-concurrent-user test
// (see server/scripts/concurrency-100.mjs): keying this purely by IP means
// 100 legitimate users behind one shared network (a hostel, an office, or
// — as in the test itself — one laptop) exhaust the budget and get
// wrongly throttled, which is exactly the T-03 failure mode the product
// doc warns against ("don't ban on IP alone"). Authenticated requests are
// keyed by their session token instead, so concurrent *different* users
// never compete for the same budget; only genuinely unauthenticated
// traffic (which can't yet be tied to a person) falls back to per-IP.
// See globalRateLimit.ts and scripts/ip-isolation-test.ts for the isolation
// test proving different IPs don't share this bucket.
app.use(createGlobalLimiter());

app.get("/health", (_req, res) => res.json({ ok: true }));
app.use("/auth", authRouter);
app.use("/logs", logsRouter);
app.use("/dishes", dishesRouter);
app.use("/moderation", moderationRouter);
app.use("/profile", profileRouter);
app.use("/recommendations", recommendationsRouter);
app.use("/venues", venuesRouter);
app.use("/notifications", notificationsRouter);
if (!isProd) app.use("/dev", devRouter);

export default app;
