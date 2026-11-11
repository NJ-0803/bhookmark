# Bhookmark: restaurant food wishlist

Updated 2026-11-11. This file supersedes the earlier multi-feature roadmap.

## Scope implemented on this branch

- Restaurant discovery limited to Bengaluru metro, paginated catalog search,
  optional live Google Places search and real restaurant-photo delivery.
- Saved food grouped by stable restaurant/branch ID, with private notes,
  reference links, tried status and optional manually entered ratings /10.
- Existing warm Evening/Daylight design, floating cards and Google login.
- Removed social, circles, rooms, lists, BiteLog, taste games/profiles,
  recommendations, AI integrations, imported ratings and notification APIs.
- Additive, rerunnable saved-item migration. No historical logs are erased.
- Wider Bengaluru OpenStreetMap refresh tool and coverage reporting.

## Deployment requirements still outstanding

- Apply `server/schema.sql` through the migration script before deployment.
- Run the wider Bengaluru catalog refresh against the intended database.
  Existing catalog coverage is not the whole city; no source guarantees all
  restaurants. Missing restaurants can be saved manually.
- Configure `GOOGLE_PLACES_API_KEY` with Places API (New) and appropriate
  Google Cloud quotas if live restaurant photos/search are desired. Without
  it, catalog search works and missing photos are labeled honestly.
- Verify live Google login, search and photo delivery with real credentials.
- Before public use of Places, publish Terms of Use and Privacy Policy that
  meet Google's requirements (see the current official Places policies).
- Perform real-phone QA on iOS Safari and Android Chrome.

No production migration, billing activation, provider configuration or
production deployment has been performed by this branch's implementation.
