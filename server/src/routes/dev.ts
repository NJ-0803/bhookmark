import { Router } from "express";
import { z } from "zod";
import * as db from "../db";
import { requireAuth } from "../middleware";

// DEV-ONLY convenience route so the moderator flow and role checks can be
// tested without a real admin console. Mounted only when NODE_ENV !== "production".
export const devRouter = Router();

const roleSchema = z.object({ role: z.enum(["user", "restaurant_owner", "moderator", "trust_analyst", "admin"]) });

devRouter.post("/set-role", requireAuth, async (req, res) => {
  const parsed = roleSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: "Invalid role." });
  const user = await db.getUserById(req.user!.sub);
  if (!user) return res.status(404).json({ ok: false, error: "User not found." });
  await db.setUserRole(user.id, parsed.data.role);
  res.json({ ok: true, note: "Role changed — request a fresh access token (log in again) to see it reflected." });
});

devRouter.get("/security-events", async (_req, res) => {
  res.json({ ok: true, events: await db.listSecurityEvents() });
});

// DEV-ONLY visibility into the AI-correction eval log (brief 1.3) — no
// admin console exists yet, and this table has no other read path.
devRouter.get("/ai-corrections", async (_req, res) => {
  res.json({ ok: true, corrections: await db.listAiCorrections() });
});
