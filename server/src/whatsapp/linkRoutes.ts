import express, { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { requireAuth, requireRecentAuth } from "../middleware";
import type { createWhatsAppExecution } from "./execution";

/** Explicit injection only. Not mounted in the normal/production app. */
export function createWhatsAppLinkRouter(engine: ReturnType<typeof createWhatsAppExecution>, enabled = false) {
  const router = Router();
  router.use((_req, res, next) => {
    res.set("Cache-Control", "private, no-store");
    if (!enabled || process.env.NODE_ENV === "production") return res.sendStatus(404);
    next();
  });
  router.use(express.json({ limit: "4kb" }), requireAuth, requireRecentAuth(300));
  router.use(rateLimit({ windowMs: 10 * 60_000, limit: 15, keyGenerator: req => req.user!.sub, standardHeaders: true, legacyHeaders: false }));
  router.post("/start", async (req, res) => res.json(await engine.beginLink(req.user!.sub)));
  router.get("/status", async (req, res) => res.json(await engine.linkStatus(req.user!.sub)));
  router.post("/confirm", async (req, res) => {
    const body = z.object({ sender: z.string().regex(/^\d{7,15}$/), confirmation: z.string().regex(/^[a-f0-9]{48}$/) }).strict().safeParse(req.body);
    if (!body.success) return res.sendStatus(400);
    const ok = await engine.confirmLink(req.user!.sub, body.data.sender, body.data.confirmation);
    return res.status(ok ? 200 : 409).json({ ok });
  });
  router.delete("/", async (req, res) => { await engine.unlink(req.user!.sub); return res.json({ ok: true }); });
  return router;
}
