import { DishLog, DietaryProfile, User } from "./db";
import { CATALOG, CatalogDish } from "./catalog";

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

function dietCompatible(user: Pick<User, "dietaryProfile" | "allergens">, dish: CatalogDish): boolean {
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
  dish: CatalogDish;
  reason: string;
}

/** AI recommender #3: the actual pick is fully rule-based and grounded in
 * the real catalog (never invented) — an optional LLM layer (see llm.ts)
 * only rewrites the explanation text, never the decision of which dish. */
export function computeNextPicks(
  user: Pick<User, "dietaryProfile" | "allergens">,
  logs: DishLog[],
  top = 3
): NextPick[] {
  const favorites = computeFavorites(logs, 5);
  const avoid = new Set(computeAvoid(logs, 5).map((g) => groupKey(g.category, g.subtype)));
  const alreadyLogged = new Set(logs.map((l) => `${l.name}|${l.venue}`));
  const favoriteCategories = new Set(favorites.map((f) => f.category));

  const candidates = CATALOG.filter(
    (d) =>
      dietCompatible(user, d) &&
      !avoid.has(groupKey(d.category, d.subtype)) &&
      !alreadyLogged.has(`${d.name}|${d.venue}`)
  );

  const ranked = candidates
    .map((d) => ({ dish: d, favoriteMatch: favoriteCategories.has(d.category) ? 1 : 0 }))
    .sort((a, b) => b.favoriteMatch - a.favoriteMatch || b.dish.score - a.dish.score);

  return ranked.slice(0, top).map(({ dish, favoriteMatch }) => ({
    dish,
    reason: favoriteMatch
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
export function computeDigest(user: Pick<User, "dietaryProfile" | "allergens">, logs: DishLog[]): Digest {
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
    nextPicks: computeNextPicks(user, logs, 1),
  };
}
