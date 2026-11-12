import express from "express";
import { proxyTrust, permittedOrigin } from "./network";
import { createChatPreviewRouter } from "./routes/chat";
import { createWhatsAppReviewRouter } from "./whatsapp/review";
import cors from "cors";
import helmet from "helmet";
import { createGlobalLimiter } from "./globalRateLimit";
import { authRouter } from "./routes/auth";
import { createBookmarksRouter } from "./routes/bookmarks";
import { restaurantsRouter } from "./routes/restaurants";

const app = express();

app.set("trust proxy", proxyTrust());

app.use(helmet());
// Same-origin requests need no CORS permission. Preview/custom origins must
// be explicitly allowed, not every unrelated tenant on vercel.app.
app.use(cors({ origin: (origin, done) => done(null, origin === undefined || permittedOrigin(origin)) }));
// Raw signed payload must be checked before JSON parsing. This review route
// is disabled by default and always returns404 in production.
app.use("/whatsapp", createWhatsAppReviewRouter());
app.use(express.json({ limit: "1mb" }));

// Authenticated traffic is limited per verified user; anonymous requests
// fall back to IP. Restaurant requests have an additional route limit.
app.use(createGlobalLimiter());

app.get("/health", (_req, res) => res.json({ ok: true }));
app.use("/auth", authRouter);
app.use("/bookmarks", createBookmarksRouter());
app.use("/restaurants", restaurantsRouter);
app.use("/chat", createChatPreviewRouter());
app.use((_req, res) => res.status(404).json({ ok: false, error: "Not found." }));
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (error instanceof SyntaxError) return res.status(400).json({ ok: false, error: "Invalid request." });
  console.error("[api] Request failed", error instanceof Error ? error.name : "Unknown error");
  return res.status(503).json({ ok: false, error: "Couldn't complete that request. Please try again." });
});

export default app;
