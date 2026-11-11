# Bhookmark

A private food wishlist for Bengaluru: find a restaurant, save the dishes
you want to eat, add notes, mark them tried, and enter your own rating.

The existing Evening/Daylight design and floating restaurant cards are kept.
Social features, games, taste profiles, AI recommendations, public ratings,
push notifications and the old BiteLog flow have been removed from the app
and API. No AI service is used. There are no imported or generated ratings.

## Run locally

Requires Node 22+ and Neon Postgres. Copy `.env.example` to `.env.local` and
fill in your own values. The API needs `DATABASE_URL`, `JWT_ACCESS_SECRET`
and `JWT_REFRESH_SECRET`. Google login also needs both Google client IDs.

```sh
npm ci
node --env-file=.env.local server/scripts/migrate.mjs
node --env-file=.env.local --import tsx server/src/index.ts
```

In another terminal, run `npm run dev`. Vite reads `.env.local` and proxies
the API to port 4001. Optional existing mkcert files enable LAN HTTPS;
otherwise localhost works without a certificate.

```sh
npm run build
npm run typecheck:server
npm run lint
npm test
```

## Restaurant coverage and real photos

The local catalog searches every active venue in the Bengaluru metro
region (12.75–13.25 N, 77.30–77.90 E), regardless of cuisine tags. Results
are paginated. `/restaurants/coverage` reports the actual catalog count,
last update and whether live search is connected. It never claims 100%
coverage. The old import covered only central Bangalore.

Refresh all named food venues returned by OpenStreetMap in the wider region:

```sh
node server/scripts/refresh-bangalore.mjs
node --env-file=.env.local server/scripts/refresh-bangalore.mjs --commit
```

The first command is a dry run. For the known production database the
write also requires `CONFIRM_PROD=1`. The importer includes nodes, ways
and relations, uses batched writes, reports conflicts and rejects partial
Overpass responses. It does not delete businesses absent from a refresh.
OpenStreetMap is incomplete: **this does not guarantee every restaurant**.

To enable broader live discovery and real branch photos, configure the
server-only `GOOGLE_PLACES_API_KEY` for Places API (New). No key, billing
account or external service is created by this change. Set project quotas
in Google Cloud before enabling it; local rate limits are per instance,
not a global spending cap. Search falls back to the local catalog if the
provider fails. Users can save a missing restaurant and dish manually.

Google details/photo metadata are fetched on demand with no-store responses,
required photo-author/source links, and Google Maps attribution. The API
key stays on the server. No provider ratings are requested. There is no
scraping, bulk Google catalog import, or permanent Google photo cache.
The app stores place IDs and the user's own confirmed bookmark text,
notes and ratings, not Google photo resources. Deployments using Places
must publish the Google-required Terms of Use and Privacy Policy with the
appropriate Google references before public release.

The local fallback deliberately has no fabricated or generic restaurant
photos. It says “Restaurant photo unavailable” until a real source is
connected. Restaurant photos are not presented as photos of a saved dish.

## Data and release

Run the additive schema migration **before** deploying this branch. Existing
`saved_dishes` rows are copied idempotently into private `food_bookmarks`.
Historical tables and logs are left intact in an existing database, but
their feature routes are gone. Historical scores are not imported because
their origin cannot be reliably identified as manual. No production data
is deleted or changed by checking out this code.

Each new save is keyed by account, restaurant/branch ID and normalized dish
name. Ratings start at null and may only be entered for a tried dish, from
0 to 10 in half-point steps. Zero is a valid manual rating. Notes/ratings
are editable; dish and restaurant identity remain fixed after saving.
All read/write/delete queries enforce account ownership.

Tests run against an isolated in-process PostgreSQL engine (PGlite), DOM
components and mocked provider responses; they never mutate a live database
or call paid services. Public production migration, catalog refresh, Google credentials,
live photo verification and real-phone QA remain deployment steps.

## Conversational preview (development only)

A channel-neutral, authenticated read-only preview is documented in [docs/CHAT_PREVIEW.md](docs/CHAT_PREVIEW.md). It never saves data or connects a messaging provider.
