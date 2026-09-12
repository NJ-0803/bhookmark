import { DishLog, User } from "./db";
import type { CatalogDishRow } from "./db";

export interface GroupStat {
  category: string;
  subtype: string;
  representativeName: string;
  representativeVenue: string;
  count: number;
  avgScore: number;
  lovedCount: number;
}

function groupKey(category: string, subtype: string) {
  return `${category}|${subtype}`;
}

function groupLogs(logs: DishLog[]): GroupStat[] {
  const groups = new Map<string, DishLog[]>();
  for (const log of logs) {
    const key = groupKey(log.category, log.subtype);
    const arr = groups.get(key) ?? [];
    arr.push(log);
    groups.set(key, arr);
  }
  return [...groups.entries()].map(([, groupLogsArr]) => {
    const last = groupLogsArr[groupLogsArr.length - 1];
    return {
      category: last.category,
      subtype: last.subtype,
      representativeName: last.name,
      representativeVenue: last.venue,
      count: groupLogsArr.length,
      avgScore: groupLogsArr.reduce((s, l) => s + l.score, 0) / groupLogsArr.length,
      lovedCount: groupLogsArr.filter((l) => l.verdict === "loved").length,
    };
  });
}

/** AI recommender #1: what this person eats most and rates highest. */
export function computeFavorites(logs: DishLog[], top = 3): GroupStat[] {
  return groupLogs(logs)
    .sort((a, b) => b.lovedCount - a.lovedCount || b.avgScore - a.avgScore)
    .slice(0, top);
}

/** AI recommender #2: what this person consistently dislikes — used to
 * actively suppress similar suggestions, not just to display. */
export function computeAvoid(logs: DishLog[], top = 3): GroupStat[] {
  const disliked = logs.filter((l) => l.verdict === "not-for-me" || l.score < 6);
  return groupLogs(disliked)
    .sort((a, b) => b.count - a.count || a.avgScore - b.avgScore)
    .slice(0, top);
}

// Phase 2 Session E: dish is now a real row from the DB catalog
// (server/src/db.ts's listCatalogDishesWithScores), not the old static
// CatalogDish — same field names, so this logic is otherwise unchanged.
// Unknown diet/allergen data (most of Session B's 4,907 OSM venues,
// until Session C/a real submission adds it) still means "not confirmed
// compatible," never "assume safe" — this is the exact behavior the
// original brief asked for ("unknown preparation is not confirmed
// compatibility"), just now applied to a real, much larger catalog
// instead of 12 hand-picked dishes.
function dietCompatible(user: Pick<User, "dietaryProfile" | "allergens">, dish: CatalogDishRow): boolean {
  if (user.allergens.some((a) => dish.allergens.includes(a))) return false;
  switch (user.dietaryProfile) {
    case "vegan":
      return dish.dietTags.includes("vegan");
    case "vegetarian":
    case "jain": // approximation — Jain also excludes root vegetables/onion-garlic,
      // which this catalog doesn't tag. Real support needs that data, not just this flag.
      return dish.dietTags.includes("veg") || dish.dietTags.includes("vegan");
    case "eggetarian":
      return dish.dietTags.some((t) => t === "veg" || t === "vegan" || t === "egg");
    case "no-restriction":
    default:
      return true;
  }
}

export interface NextPick {
  dish: CatalogDishRow;
  reason: string;
  hasEvidence: boolean;
}

/** AI recommender #3: the actual pick is fully rule-based and grounded in
 * the real catalog (never invented) — the explanation text is a deterministic
 * template, not a model call (no paid API, per the zero-cost decision).
 *
 * Phase 2 Session E: `catalog` is now the real, DB-backed dish list
 * (thousands of rows, mostly from Session B's OSM ingestion) instead of
 * 12 hardcoded ones — recommend.ts stays a pure function over
 * already-fetched data (the route fetches `catalog` once per request,
 * same as it already did for `logs`), so this remains fully testable
 * without a live DB. Ranking never interleaves a real average score with
 * an unscored dish's absence of one: every candidate with real log
 * evidence outranks every candidate without it, full stop — a dish
 * nobody's logged yet is never allowed to look more proven than one with
 * a real, if lower, average. */
export function computeNextPicks(
  user: Pick<User, "dietaryProfile" | "allergens">,
  logs: DishLog[],
  catalog: CatalogDishRow[],
  top = 3
): NextPick[] {
  const favorites = computeFavorites(logs, 5);
  const avoid = new Set(computeAvoid(logs, 5).map((g) => groupKey(g.category, g.subtype)));
  const alreadyLogged = new Set(logs.map((l) => `${l.name}|${l.venue}`));
  const favoriteCategories = new Set(favorites.map((f) => f.category));

  const candidates = catalog.filter(
    (d) =>
      dietCompatible(user, d) &&
      !avoid.has(groupKey(d.category, d.subtype)) &&
      !alreadyLogged.has(`${d.name}|${d.venue}`)
  );

  const ranked = candidates
    .map((d) => ({ dish: d, favoriteMatch: favoriteCategories.has(d.category) ? 1 : 0, hasEvidence: d.evidenceCount > 0 }))
    .sort((a, b) => {
      // Real evidence always outranks none, before anything else.
      if (a.hasEvidence !== b.hasEvidence) return a.hasEvidence ? -1 : 1;
      if (a.favoriteMatch !== b.favoriteMatch) return b.favoriteMatch - a.favoriteMatch;
      return (b.dish.evidenceScore ?? 0) - (a.dish.evidenceScore ?? 0);
    });

  return ranked.slice(0, top).map(({ dish, favoriteMatch, hasEvidence }) => ({
    dish,
    hasEvidence,
    reason: !hasEvidence
      ? `A pick that fits your dietary profile — no community ratings yet, be the first.`
      : favoriteMatch
      ? `You keep coming back to ${dish.category} — this is the top-rated one you haven't logged yet.`
      : `A well-rated pick that fits your dietary profile and doesn't overlap anything you've marked "not for me."`,
  }));
}

export interface Digest {
  daysSinceLastLog: number | null;
  logsThisWeek: number;
  topCategoryThisWeek: string | null;
  personalBestThisWeek: { name: string; venue: string; score: number } | null;
  nextPicks: NextPick[];
}

/** The engagement-gap fix: a reason to open the app when you're not
 * actively hungry — computed from real logged data, not placeholder copy. */
export function computeDigest(user: Pick<User, "dietaryProfile" | "allergens">, logs: DishLog[], catalog: CatalogDishRow[]): Digest {
  const now = Date.now();
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  const sorted = [...logs].sort((a, b) => b.createdAt - a.createdAt);
  const daysSinceLastLog = sorted.length ? Math.floor((now - sorted[0].createdAt) / (24 * 60 * 60 * 1000)) : null;

  const thisWeek = logs.filter((l) => now - l.createdAt < weekMs);
  const byCategory = new Map<string, number>();
  thisWeek.forEach((l) => byCategory.set(l.category, (byCategory.get(l.category) ?? 0) + 1));
  const topCategoryThisWeek = [...byCategory.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  const best = [...thisWeek].sort((a, b) => b.score - a.score)[0] ?? null;

  return {
    daysSinceLastLog,
    logsThisWeek: thisWeek.length,
    topCategoryThisWeek,
    personalBestThisWeek: best ? { name: best.name, venue: best.venue, score: best.score } : null,
    nextPicks: computeNextPicks(user, logs, catalog, 1),
  };
}
