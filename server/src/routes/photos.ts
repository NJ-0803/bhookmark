import express, { Router, type NextFunction, type Request, type Response } from "express";
import { nanoid } from "nanoid";
import { put } from "@vercel/blob";
import { z } from "zod";
import * as db from "../db";
import { requireAuth } from "../middleware";

// Log photos: stored in the public Vercel Blob store (bhookmark-photos) so
// other people can see them on public logs. Uploads go through this route
// (not browser-direct) so every one is signed-in, type-checked, counted and
// tied to the account that made it.
export const photosRouter = Router();

// Vercel Blob's free Hobby plan includes 2,000 uploads a month and stops
// working for 30 days if any limit is exceeded, so uploads pause well short
// of it. A log always saves without its photo.
const MONTHLY_UPLOAD_CAP = 1800;
const DAILY_UPLOADS_PER_USER = 30;
const MAX_BYTES = 1.5 * 1024 * 1024;
const REPORTS_TO_HIDE = 2;
const EXTENSIONS: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

/** The real image type from the file's first bytes — the declared
 * Content-Type alone is never trusted. */
function sniffImageType(buf: Buffer): string | null {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.length > 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}

const rawImage = express.raw({ type: Object.keys(EXTENSIONS), limit: MAX_BYTES });
function readImage(req: Request, res: Response, next: NextFunction) {
  rawImage(req, res, (err?: { type?: string }) => {
    if (!err) return next();
    const tooLarge = err.type === "entity.too.large";
    res.status(tooLarge ? 413 : 400).json({ ok: false, error: tooLarge ? "Photos can be up to 1.5 MB." : "Couldn't read that image." });
  });
}

photosRouter.post("/", requireAuth, readImage, async (req, res) => {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return res.status(503).json({ ok: false, error: "Photo uploads aren't set up on this server." });

  const body = req.body;
  if (!Buffer.isBuffer(body) || body.length === 0) return res.status(400).json({ ok: false, error: "Send a JPEG, PNG or WebP photo." });
  const type = sniffImageType(body);
  if (!type) return res.status(400).json({ ok: false, error: "That file isn't a JPEG, PNG or WebP photo." });

  const userId = req.user!.sub;
  const now = Date.now();
  const monthStart = new Date(now);
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const [thisMonth, todayForUser] = await Promise.all([
    db.countPhotoUploadsSince(monthStart.getTime()),
    db.countPhotoUploadsSince(now - 24 * 60 * 60 * 1000, userId),
  ]);
  if (thisMonth >= MONTHLY_UPLOAD_CAP) {
    return res.status(503).json({ ok: false, error: "Photo uploads are paused until next month. Your log still saves without it." });
  }
  if (todayForUser >= DAILY_UPLOADS_PER_USER) {
    return res.status(429).json({ ok: false, error: "That's the photo limit for today. Your log still saves without it." });
  }

  const blob = await put(`logs/${userId}/${nanoid()}.${EXTENSIONS[type]}`, body, { access: "public", contentType: type, token });
  await db.recordPhotoUpload(userId, blob.url, body.length);
  res.status(201).json({ ok: true, url: blob.url });
});

const reportSchema = z.object({ logId: z.string().min(1).max(64) });

photosRouter.post("/report", requireAuth, async (req, res) => {
  const parsed = reportSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: "Say which photo to report." });
  const log = await db.getLogById(parsed.data.logId);
  if (!log || !log.photoUrl) return res.status(404).json({ ok: false, error: "There's no photo on that log." });
  if (log.userId === req.user!.sub) return res.status(400).json({ ok: false, error: "That's your own photo." });
  const result = await db.reportLogPhoto(log.id, req.user!.sub, REPORTS_TO_HIDE);
  res.json({ ok: true, hidden: result.hidden });
});
