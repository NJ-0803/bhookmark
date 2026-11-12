import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware";
import { bookmarkStore } from "../bookmarks";
import { searchLocal } from "../restaurants";
import { previewMessage, type PreviewDependencies } from "../chat/preview";

/** No provider, paid service or write path. Explicitly unavailable in production. */
export function createChatPreviewRouter(deps: PreviewDependencies = {
  list: (userId) => bookmarkStore.list(userId),
  search: async (query) => {
    const full = (await searchLocal(query)).restaurants;
    if (full.length) return full;
    // The catalog uses phrase matching. Try the leading restaurant word once
    // when a natural branch query ("Toit Indiranagar") is not contiguous in SQL.
    const words = query.trim().split(/\s+/);
    if (words.length < 2) return [];
    const matches = (await searchLocal(words[0])).restaurants;
    return matches.filter(r => words.every(w => `${r.name} ${r.address}`.toLocaleLowerCase("en-IN").includes(w.toLocaleLowerCase("en-IN"))));
  },
}, enabled = process.env.NODE_ENV !== "production" && process.env.BHOOKMARK_CHAT_PREVIEW === "1") {
  const router = Router();
  router.use((_req, res, next) => {
    res.set("Cache-Control", "private, no-store");
    if (!enabled) return res.status(404).json({ ok: false, error: "Not found." });
    next();
  });
  router.use(requireAuth);
  router.post("/preview", async (req, res) => {
    const body = z.object({ message: z.string().trim().min(1).max(2000) }).strict().safeParse(req.body);
    if (!body.success) return res.status(400).json({ ok: false, error: "Send a message of 1 to 2000 characters." });
    const preview = await previewMessage(req.user!.sub, body.data.message, deps);
    return res.json({ ok: true, mode: "preview", writesEnabled: false, preview });
  });
  return router;
}
