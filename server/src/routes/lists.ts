import { Router } from "express";
import { nanoid } from "nanoid";
import { z } from "zod";
import * as db from "../db";
import { requireAuth } from "../middleware";

export const listsRouter = Router();

const itemSchema = z.object({ dishName: z.string().trim().min(1).max(80), venue: z.string().trim().min(1).max(80) });
const createSchema = z.object({ title: z.string().trim().min(1).max(80), items: z.array(itemSchema).min(1).max(20) });

listsRouter.post("/", requireAuth, async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: "Give the list a title and at least one dish." });

  const list = await db.createList(nanoid(), parsed.data.title, req.user!.sub, parsed.data.items);
  res.status(201).json({ ok: true, list, items: parsed.data.items, clones: 0 });
});

listsRouter.get("/", requireAuth, async (_req, res) => {
  const lists = await db.listListsFeed();
  const withDetail = await Promise.all(
    lists.map(async (l) => ({
      ...l,
      items: await db.getListItems(l.id),
      clones: await db.countClones(l.id),
    }))
  );
  res.json({ ok: true, lists: withDetail });
});

listsRouter.get("/:id", requireAuth, async (req, res) => {
  const list = await db.getListById(req.params.id as string);
  if (!list) return res.status(404).json({ ok: false, error: "List not found." });
  const [items, clones] = await Promise.all([db.getListItems(list.id), db.countClones(list.id)]);
  res.json({ ok: true, list, items, clones });
});

const cloneSchema = z.object({ title: z.string().trim().min(1).max(80).optional() });

// The clone is a real, independent list the cloner now owns — parentListId
// keeps the lineage so the original's clone count stays a real COUNT(*),
// not a number bumped in place.
listsRouter.post("/:id/clone", requireAuth, async (req, res) => {
  const original = await db.getListById(req.params.id as string);
  if (!original) return res.status(404).json({ ok: false, error: "List not found." });
  const parsed = cloneSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ ok: false, error: "Invalid title." });

  const items = await db.getListItems(original.id);
  const clone = await db.createList(nanoid(), parsed.data.title ?? original.title, req.user!.sub, items, original.id);
  res.status(201).json({ ok: true, list: clone, items });
});
