// Single source of truth for "is this DATABASE_URL production," shared by
// assertTestDatabase.mjs and any script that needs to know the difference
// (e.g. ingest-osm-venues.mjs's --commit guard). Neon branch endpoint
// hostnames are opaque/random, not derived from the branch name, so this
// checks against the known production host rather than guessing from a
// naming pattern. Update this if the production database's host ever
// changes (a Neon project migration, a new default branch, etc.).
export const PRODUCTION_HOST_FRAGMENT = "divine-thunder-awnglmru";

export function isKnownProductionUrl(url) {
  return (url ?? "").includes(PRODUCTION_HOST_FRAGMENT);
}
