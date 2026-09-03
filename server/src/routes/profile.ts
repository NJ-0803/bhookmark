import { Router } from "express";
import { z } from "zod";
import * as db from "../db";
import type { DietaryProfile } from "../db";
import { requireAuth } from "../middleware";

export const profileRouter = Router();

profileRouter.get("/", requireAuth, async (req, res) => {
  const user = await db.getUserById(req.user!.sub);
  if (!user) return res.status(404).json({ ok: false, error: "User not found." });
  res.json({ ok: true, dietaryProfile: user.dietaryProfile, allergens: user.allergens });
});

const dietSchema = z.object({
  dietaryProfile: z.enum(["no-restriction", "vegetarian", "vegan", "jain", "eggetarian"]),
  allergens: z.array(z.string()).max(10),
});

// Food-specific gap fix: a persistent dietary profile that the whole app —
// search, recommendations, dish warnings — reads from, instead of the user
// re-filtering every single search by hand.
profileRouter.patch("/diet", requireAuth, async (req, res) => {
  const parsed = dietSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: "Invalid dietary profile." });
  const user = await db.getUserById(req.user!.sub);
  if (!user) return res.status(404).json({ ok: false, error: "User not found." });
  const dietaryProfile = parsed.data.dietaryProfile as DietaryProfile;
  await db.setUserDiet(user.id, dietaryProfile, parsed.data.allergens);
  res.json({ ok: true, dietaryProfile, allergens: parsed.data.allergens });
});
