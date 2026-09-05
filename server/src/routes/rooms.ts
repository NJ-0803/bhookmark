import { Router } from "express";
import { nanoid } from "nanoid";
import { z } from "zod";
import * as db from "../db";
import { requireAuth } from "../middleware";

export const roomsRouter = Router();

const ROOM_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours — a real disposable session, not a permanent room

const createSchema = z.object({
  mood: z.string().trim().min(1).max(40),
  radiusKm: z.coerce.number().min(1).max(10),
  // The creator's client picks these (from the real catalog, same logic
  // already used to preview candidates) — the server just fixes them so
  // every joiner swipes on the identical list, never its own guess at it.
  candidateIds: z.array(z.string()).min(1).max(20),
});

roomsRouter.post("/", requireAuth, async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: "Pick a mood and radius first." });

  const room = await db.createCravingRoom(nanoid(), req.user!.sub, parsed.data.mood, parsed.data.radiusKm, parsed.data.candidateIds, ROOM_TTL_MS);
  res.status(201).json({ ok: true, room });
});

const joinSchema = z.object({ code: z.string().trim().min(4).max(8) });

roomsRouter.post("/join", requireAuth, async (req, res) => {
  const parsed = joinSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: "Enter a room code." });

  const room = await db.getRoomByCode(parsed.data.code);
  if (!room) return res.status(404).json({ ok: false, error: "That room doesn't exist or has expired." });

  await db.joinRoom(room.id, req.user!.sub);
  res.json({ ok: true, room });
});

async function loadRoomDetail(roomId: string) {
  const room = await db.getRoomById(roomId);
  if (!room) return null;
  const [participants, swipes] = await Promise.all([db.listRoomParticipants(roomId), db.listRoomSwipes(roomId)]);
  const swipesByUser = new Map<string, number>();
  swipes.forEach((s) => swipesByUser.set(s.userId, (swipesByUser.get(s.userId) ?? 0) + 1));
  const participantsWithProgress = participants.map((p) => ({
    id: p.id,
    swipeCount: swipesByUser.get(p.id) ?? 0,
    done: (swipesByUser.get(p.id) ?? 0) >= room.candidateIds.length,
  }));
  const everyoneDone = participantsWithProgress.length > 0 && participantsWithProgress.every((p) => p.done);
  return { room, participants: participantsWithProgress, everyoneDone, swipes };
}

roomsRouter.get("/:id", requireAuth, async (req, res) => {
  const detail = await loadRoomDetail(req.params.id as string);
  if (!detail) return res.status(404).json({ ok: false, error: "Room not found." });
  const isParticipant = detail.participants.some((p) => p.id === req.user!.sub);
  if (!isParticipant) return res.status(403).json({ ok: false, error: "Not in this room." });
  res.json({ ok: true, room: detail.room, participants: detail.participants, everyoneDone: detail.everyoneDone });
});

const swipeSchema = z.object({ dishId: z.string().min(1), liked: z.boolean() });

roomsRouter.post("/:id/swipe", requireAuth, async (req, res) => {
  const room = await db.getRoomById(req.params.id as string);
  if (!room) return res.status(404).json({ ok: false, error: "Room not found." });
  const parsed = swipeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: "Missing dish or verdict." });
  if (!room.candidateIds.includes(parsed.data.dishId)) {
    return res.status(400).json({ ok: false, error: "That dish isn't in this room." });
  }

  await db.recordRoomSwipe(room.id, req.user!.sub, parsed.data.dishId, parsed.data.liked);
  if (room.status === "setup") await db.setRoomStatus(room.id, "swiping");

  const detail = await loadRoomDetail(room.id);
  res.json({ ok: true, everyoneDone: detail?.everyoneDone ?? false });
});

// Real overlap: a dish only counts if every current participant liked it —
// computed fresh from the swipes table each time, never cached/guessed.
roomsRouter.get("/:id/reveal", requireAuth, async (req, res) => {
  const detail = await loadRoomDetail(req.params.id as string);
  if (!detail) return res.status(404).json({ ok: false, error: "Room not found." });
  const isParticipant = detail.participants.some((p) => p.id === req.user!.sub);
  if (!isParticipant) return res.status(403).json({ ok: false, error: "Not in this room." });

  if (!detail.everyoneDone) {
    return res.json({ ok: true, ready: false, doneCount: detail.participants.filter((p) => p.done).length, totalCount: detail.participants.length });
  }

  if (detail.room.status !== "revealed") await db.setRoomStatus(detail.room.id, "revealed");

  const likesByDish = new Map<string, number>();
  detail.swipes.forEach((s) => {
    if (s.liked) likesByDish.set(s.dishId, (likesByDish.get(s.dishId) ?? 0) + 1);
  });
  const participantCount = detail.participants.length;
  const unanimous = detail.room.candidateIds.filter((id) => (likesByDish.get(id) ?? 0) === participantCount);
  const partial = detail.room.candidateIds.filter((id) => {
    const n = likesByDish.get(id) ?? 0;
    return n > 0 && n < participantCount;
  });

  res.json({ ok: true, ready: true, unanimous, partial });
});
