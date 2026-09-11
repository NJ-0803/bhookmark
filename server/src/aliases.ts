// Category/dish-name alias resolution (Phase 2). Pure functions over an
// already-fetched alias map — no DB access here, so both the OSM ingestion
// script (resolving hundreds of cuisine tags in one run) and a live route
// (resolving one search term per request) can reuse the same logic without
// either one paying for per-lookup round trips.
//
// This is the structural fix for the bug that broke Coffee search in
// Phase 1: a spelling only ever has to be correct in ONE place (this
// table) instead of scattered across hardcoded arrays that can silently
// drift out of sync with each other.

export interface AliasMap {
  aliases: Map<string, string>;
  canonical: Set<string>;
}

// OSM tags use snake_case ("coffee_shop", "south_indian") where this app's
// canonical categories and most alias seeds use spaces/title case
// ("Coffee", "South Indian Meals & Tiffin") — normalize once, consistently,
// rather than seeding every underscore variant by hand.
export function normalizeTerm(term: string): string {
  return term.trim().toLowerCase().replace(/_/g, " ").replace(/\s+/g, " ");
}

// Resolves a raw search/tag term to a canonical category, or null if it
// genuinely can't be resolved — callers must treat null as "don't guess,"
// never fall back to a default category, since a wrong guess is worse than
// an honestly-skipped venue.
export function resolveCategory(term: string, map: AliasMap): string | null {
  const normalized = normalizeTerm(term);
  if (!normalized) return null;
  const aliased = map.aliases.get(normalized);
  if (aliased) return aliased;
  for (const category of map.canonical) {
    if (category.toLowerCase() === normalized) return category;
  }
  return null;
}

// OSM's cuisine tag can hold multiple semicolon-separated values
// ("indian;chinese") — try each in order, first resolvable wins. Callers
// pass amenity-derived fallback candidates (e.g. "cafe") after the real
// cuisine values so an explicit cuisine tag always outranks the generic
// amenity guess.
export function resolveCategoryFromCandidates(candidates: string[], map: AliasMap): string | null {
  for (const candidate of candidates) {
    const resolved = resolveCategory(candidate, map);
    if (resolved) return resolved;
  }
  return null;
}

export function expandDishNameQuery(term: string, dishAliases: Map<string, string>): string[] {
  const normalized = normalizeTerm(term);
  const expanded = new Set([normalized]);
  const canonical = dishAliases.get(normalized);
  if (canonical) expanded.add(canonical);
  return [...expanded];
}
