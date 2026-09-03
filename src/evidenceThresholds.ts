import type { RemoteLog } from "./api";

// Brief section 1.1: a "signature craving" is a confident claim about
// someone's taste, and the un-gated version of this app could make that
// claim after a single logged dish. Require real repetition — across
// venues, not just repeat visits to one place — before showing it as fact.
const LOGS_NEEDED = 5;
const VENUES_NEEDED = 3;
const STRONG_LOGS = 15;
const STRONG_VENUES = 6;

export type SignatureCravingResult =
  | { unlocked: true; category: string; band: "developing" | "strong" }
  | { unlocked: false; logsSeen: number; logsNeeded: number; venuesSeen: number; venuesNeeded: number };

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

  if (!best || best.logs.length < LOGS_NEEDED || best.venues.size < VENUES_NEEDED) {
    return {
      unlocked: false,
      logsSeen: best?.logs.length ?? 0,
      logsNeeded: LOGS_NEEDED,
      venuesSeen: best?.venues.size ?? 0,
      venuesNeeded: VENUES_NEEDED,
    };
  }

  return {
    unlocked: true,
    category: best.category,
    band: best.logs.length >= STRONG_LOGS && best.venues.size >= STRONG_VENUES ? "strong" : "developing",
  };
}
