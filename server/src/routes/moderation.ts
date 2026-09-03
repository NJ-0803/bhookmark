import { Router } from "express";
import * as db from "../db";
import { requireAuth, requireRole } from "../middleware";

export const moderationRouter = Router();

// Section 13: progressive enforcement, not a single verified switch.
// Every route here is deny-by-default to non-moderators (A07).
moderationRouter.use(requireAuth, requireRole("moderator", "admin"));

moderationRouter.get("/queue", async (_req, res) => {
  const held = await db.listHeldLogs();
  res.json({ ok: true, queue: held });
});

moderationRouter.post("/logs/:id/release", async (req, res) => {
  const log = await db.setLogStatus(req.params.id as string, "published");
  if (!log) return res.status(404).json({ ok: false, error: "Not found." });
  res.json({ ok: true, log });
});

moderationRouter.post("/logs/:id/remove", async (req, res) => {
  const log = await db.setLogStatus(req.params.id as string, "removed");
  if (!log) return res.status(404).json({ ok: false, error: "Not found." });
  res.json({ ok: true, log });
});
