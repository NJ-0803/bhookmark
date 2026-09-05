import { Router } from "express";
import { nanoid } from "nanoid";
import { z } from "zod";
import * as db from "../db";
import { requireAuth } from "../middleware";

export const circlesRouter = Router();

const createSchema = z.object({
  name: z.string().trim().min(1).max(60),
  memberIds: z.array(z.string()).max(50).default([]),
});

// A circle is built from a user's existing friends, not a separate invite
// code — the group is meant to persist, unlike a Craving Room's throwaway
// session code. Every proposed member must already be a real friend.
circlesRouter.post("/", requireAuth, async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: "Give the circle a name." });

  const friends = await db.listFriends(req.user!.sub);
  const friendIds = new Set(friends.map((f) => f.id));
  const validMembers = parsed.data.memberIds.filter((id) => friendIds.has(id));

  const circle = await db.createCircle(nanoid(), parsed.data.name, req.user!.sub, validMembers);
  res.status(201).json({ ok: true, circle });
});

circlesRouter.get("/", requireAuth, async (req, res) => {
  const circles = await db.listCirclesForUser(req.user!.sub);
  const withDetail = await Promise.all(
    circles.map(async (c) => {
      const members = await db.listCircleMembers(c.id);
      const matchScore = await db.computeCircleMatchScore(members.map((m) => m.id));
      return { ...c, memberCount: members.length, matchScore };
    })
  );
  res.json({ ok: true, circles: withDetail });
});

circlesRouter.get("/:id", requireAuth, async (req, res) => {
  const isMember = await db.isCircleMember(req.params.id as string, req.user!.sub);
  if (!isMember) return res.status(404).json({ ok: false, error: "Circle not found." });

  const members = await db.listCircleMembers(req.params.id as string);
  const matchScore = await db.computeCircleMatchScore(members.map((m) => m.id));
  res.json({ ok: true, members, matchScore });
});
