import type { RemoteLog } from "./api";

// Brief section 1.1 + evidence table: a taste claim must scale with real
// repetition, not jump straight from silence to a confident claim. Three
// tiers, matching the brief's own table exactly:
//   "insufficient" — nothing worth saying yet
//   "early"        — 3+ logs in one category: a qualitative, hedged hint
//   "unlocked"     — 5+ logs across 3+ venues: the actual signature-craving claim
export const EARLY_LOGS_NEEDED = 3;
export const LOGS_NEEDED = 5;
export const VENUES_NEEDED = 3;
const STRONG_LOGS = 15;
const STRONG_VENUES = 6;

export type SignatureCravingResult =
  | { tier: "unlocked"; category: string; band: "developing" | "strong" }
  | { tier: "early"; category: string; logsSeen: number; venuesSeen: number }
  | { tier: "insufficient"; logsSeen: number; logsNeeded: number; venuesSeen: number; venuesNeeded: number };

/** Logs and distinct venues per category, most-logged first — the same
 * grouping signatureCraving uses, so progress copy can name the category
 * that is actually closest to a pattern. */
export function categoryCounts(logs: RemoteLog[]): { category: string; logs: number; venues: number }[] {
  const byCategory = new Map<string, { logs: number; venues: Set<string> }>();
  for (const l of logs) {
    if (l.status === "removed") continue;
    const entry = byCategory.get(l.category) ?? { logs: 0, venues: new Set<string>() };
    entry.logs++;
    entry.venues.add(l.venue);
    byCategory.set(l.category, entry);
  }
  return [...byCategory.entries()]
    .map(([category, e]) => ({ category, logs: e.logs, venues: e.venues.size }))
    .sort((a, b) => b.logs - a.logs || b.venues - a.venues);
}

export function signatureCraving(logs: RemoteLog[]): SignatureCravingResult {
  const eligible = logs.filter((l) => l.status !== "removed");
  const byCategory = new Map<string, RemoteLog[]>();
  eligible.forEach((l) => {
    const arr = byCategory.get(l.category) ?? [];
    arr.push(l);
    byCategory.set(l.category, arr);
  });

  let best: { category: string; logs: RemoteLog[]; venues: Set<string> } | null = null;
  for (const [category, catLogs] of byCategory) {
    if (!best || catLogs.length > best.logs.length) {
      best = { category, logs: catLogs, venues: new Set(catLogs.map((l) => l.venue)) };
    }
  }

  if (best && best.logs.length >= LOGS_NEEDED && best.venues.size >= VENUES_NEEDED) {
    return {
      tier: "unlocked",
      category: best.category,
      band: best.logs.length >= STRONG_LOGS && best.venues.size >= STRONG_VENUES ? "strong" : "developing",
    };
  }

  if (best && best.logs.length >= EARLY_LOGS_NEEDED) {
    return { tier: "early", category: best.category, logsSeen: best.logs.length, venuesSeen: best.venues.size };
  }

  return {
    tier: "insufficient",
    logsSeen: best?.logs.length ?? 0,
    logsNeeded: LOGS_NEEDED,
    venuesSeen: best?.venues.size ?? 0,
    venuesNeeded: VENUES_NEEDED,
  };
}
