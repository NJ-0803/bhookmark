import { Router } from "express";
import { nanoid } from "nanoid";
import { bookmarkSchema, bookmarkStore, type BookmarkStore } from "../bookmarks";
import { requireAuth } from "../middleware";

export function createBookmarksRouter(store: BookmarkStore = bookmarkStore) {
  const router = Router();
  router.use(requireAuth);
  router.get("/", async (req, res) => res.json({ ok: true, bookmarks: await store.list(req.user!.sub) }));
  router.post("/", async (req, res) => {
    const parsed = bookmarkSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.issues[0]?.message ?? "Check the dish details." });
    const bookmark = await store.save(req.user!.sub, nanoid(), parsed.data);
    if (!bookmark) return res.status(409).json({ ok: false, error: "Your list is full (500 dishes). Remove a dish before adding another." });
    return res.json({ ok: true, bookmark });
  });
  router.patch("/:id", async (req, res) => {
    const parsed = bookmarkSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.issues[0]?.message ?? "Check the dish details." });
    const bookmark = await store.update(req.user!.sub, req.params.id as string, parsed.data);
    if (!bookmark) return res.status(404).json({ ok: false, error: "Saved dish not found." });
    return res.json({ ok: true, bookmark });
  });
  router.delete("/:id", async (req, res) => {
    const removed = await store.remove(req.user!.sub, req.params.id as string);
    if (!removed) return res.status(404).json({ ok: false, error: "Saved dish not found." });
    return res.json({ ok: true });
  });
  return router;
}
