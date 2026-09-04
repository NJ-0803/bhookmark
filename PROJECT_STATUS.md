# Project Status — Bhookmark

Last updated: 2026-09-04

> Note on naming: the app was built under the name "Project Palate" / "Palate" and has been renamed to **Bhookmark** (Bhook + Bookmark). **The rename is complete** in the codebase: every user-facing string, the page title, `package.json`, the journal screen/tab (renamed `Palate.tsx` → `Bhookmarks.tsx`, tab id `palate` → `bhookmarks`), localStorage keys, service worker copy, and backend log/comment references all say Bhookmark now. The GitHub repo and Vercel project slug are being renamed next (approved by the user — GitHub auto-redirects the old URL, Vercel just changes the default `*.vercel.app` subdomain). Copy was also reworked to lean into the "bhookmark" verb: the Home headline ("What are you bhookmarking now? 😏🤤😂"), the "would reorder" stat ("Would bhookmark again"), and the verified-badge/empty-state copy that used to say "worth ordering again" / "whether to reorder."

## What has been completed

### Phase 1 — Trust and data correctness (from the implementation brief) — closed
- Evidence-aware taste intelligence: 3-tier gating (early hint at 3 logs, signature craving at 5 logs/3 venues, confidence bands) — `src/evidenceThresholds.ts`, wired into `Profile.tsx` and `Bhookmarks.tsx`.
- Score separation: Your / Community / Verified-only ratings, each with real sample sizes and a confidence band, no blended number — `server/src/routes/dishes.ts` (`GET /dishes/score`), `server/src/evidence.ts`.
- Real geolocation verification: BiteLog calls `navigator.geolocation` for real; server cross-checks against known venue coordinates (haversine) — `server/src/routes/logs.ts` (`computeLocationMatch`).
- Ranking-manipulation controls, all real, all tested, all **hold for review** (never auto-block):
  - Venue burst (same device+venue, >5 in 10min)
  - Multi-account/same-network (4+ distinct accounts from one IP in 24h) — needed `app.set("trust proxy", true)` in `app.ts`, which was also a real pre-existing gap (IP-based rate limiting had been silently broken since the Vercel deploy)
  - Repeated delete-and-repost (3rd cycle at the same venue in a day)
  - Impossible travel (two location-verified logs too far apart, too fast — calibrated to this app's real ~9km max venue spread)
- Restaurant self-rating disclosure: venue-claim → moderator-approval flow (`venue_claims` table); an approved owner's own logs at their venue are excluded from every public aggregate but still show (labeled) in their own journal — `server/src/routes/venues.ts`, `server/src/routes/moderation.ts`, `src/screens/Profile.tsx` ("Run a restaurant?" card).
- Credibility layer: `WhyThis` component wired into dish-score breakdowns, recommended-pick reasons, and the verified badge in BiteLog.
- Real trending signal: `GET /dishes/trending`, a genuine 7-day log count with a minimum-evidence floor (5 logs / 3 distinct users) and QA-fixture exclusion — replaces an earlier "Trending" label that had no real time-window behind it (a real bug this session caught in its own prior work and fixed).
- **Explicitly closed, not deferred**: creator-led brigading and paid/sponsored-content disclosure. Both need infrastructure (a real social graph, a business model for sponsorship) that doesn't exist and isn't being built. Not on the list anymore, by the user's decision.

### AI dish recognition — built, then fully removed by decision
A complete real-vision backend (Claude vision via tool-use, honest failure modes, daily+global cost caps) was built, tested, and verified. The user then decided — after seeing the real, verified per-call cost (~$0.005–0.01, confirmed against Anthropic's actual published pricing) — that **any** ongoing paid cost was unacceptable, even a fully bounded ~$12/month worst case. All of it was removed, not left dormant:
- Deleted: `server/src/vision.ts`, `server/scripts/vision-test.mjs`
- Removed: `/logs/detect`, `/logs/detect/status`, `/logs/correction` routes and their cost-cap logic; `/dev/ai-corrections`; `db.ts`'s `recordAiCorrection`/`listAiCorrections`; the `ai_corrections` table from `schema.sql` (the table itself still exists in the live prod DB with a few test rows — not dropped without an explicit ask)
- `LogFlow.tsx` capture step reverted to a plain optional photo attach (Taste Receipt only, never analyzed)
- **This is a closed decision, not a paused one.** Don't re-propose AI vision unless the user brings it up.

### Privacy visibility (Phase 2 item, just completed)
Per-log `visibility: "private" | "public"` (public is the default — deliberate, since this app's core loop is a shared community score, not a private-first diary). A private log:
- Still posts, still goes through all the same evidence/ranking checks
- Still shows in the owner's own Bhookmarks journal (labeled 🔒 Private)
- Is excluded from all four public read paths: `listPublishedLogs`, `listPublishedLogsByCategorySubtype`, `listPublishedLogsForDish`, `getTrendingDish`

UI: a toggle in BiteLog's confirm step (`src/screens/LogFlow.tsx`). "Circle-only" visibility is explicitly not built — Circles has no real backend to be visible *to* yet.

### Visual redesign (Phase 5, mostly done)
Home/Crave: circular real-photo category rail, a "Trending"/"Top rated" spotlight card, photo-forward "Recommended for you" cards, category-accent colors, page-transition motion.

Extended to the rest of the app this session: `CATEGORY_ACCENT` and `findDishPhoto` moved to `src/data/dishes.ts` (shared, no longer duplicated in Home.tsx) so every screen reads from one source.
- **Bhookmarks** (`src/screens/Bhookmarks.tsx`): log cards now use a larger photo-forward `DishThumb` (real catalog photo when the log matches one, via `findDishPhoto`) with a category-accent pill badge overlaid on the corner.
- **Profile**: every card now fades in staggered on load (previously zero motion); the Signature Craving card shows a category-accent pill once a pattern is unlocked or hinted.
- **Circles**: `FoodCircles.tsx` gained a conic-gradient match-score ring and avatar-initial stacks per circle; `RemixableLists.tsx` gained a colored accent spine + tinted clone-count badge per list; both use the same stagger-fade motion as everywhere else. `CravingRoom.tsx` already had this treatment and was left as-is.

**Not done**: a full accessibility audit (44×44 targets, screen-reader pass, contrast) — that's the one remaining Phase 5 item.

### Also fixed this session
- Horizontal swipeable results deck (Tinder-style) replacing a bland vertical list capped at ~2 static demo dishes; expanded the Pizza catalog to 10 real Bangalore chains.
- Added Momos as a full category (real chain: Wow! Momo).
- Real geography + weather personalization (`src/smartPicks.ts`) — reverse-geocodes via OpenStreetMap Nominatim, pulls live weather via Open-Meteo, reorders categories. Explicit opt-in, never silent. **Caveat**: Nominatim's usage policy doesn't permit heavy production client-side traffic — fine at current scale, needs a paid geocoding provider + server-side caching before real scale.
- Festival-based suggestions were considered and explicitly **not** built — no verified 2026 festival dates exist to hardcode, and guessing would be exactly the kind of fabricated-confidence bug this whole session has been removing elsewhere.

## Important decisions (so future work doesn't re-litigate these)
1. **No paid APIs, period**, until there's a revenue model. This closed AI vision recognition entirely (see above) — don't propose it again unassisted.
2. **No photo persistence.** No object storage exists; nothing is stored beyond the duration of a request. This also closes off photo-reuse/receipt-reuse detection (Phase 1 item 5) until this changes.
3. **Public-by-default logging**, not private-by-default — a deliberate departure from the brief's generic guidance, made because this app's product is a shared community score.
4. **Minimum-age / parental-consent policy: not needed** — the user's explicit call, not to be second-guessed or re-raised.
5. **Domain**: recommended `.com` via Porkbun or Cloudflare Registrar (flat $11.08/year, no renewal bait-and-switch) over `.in` (cheaper but reads as India-only) or `.app` (real 70% renewal price jump). User has not yet purchased a domain.
6. **Rename to "Bhookmark"** — done in-app; GitHub repo + Vercel slug rename in progress (user approved renaming both).
7. **1M-user-scale performance/load testing**: permanently out of scope, per explicit user instruction.
8. Reliability tests (network-drop mid-upload, background-job idempotency) beyond what's already covered: deferred, not urgent.

## Current problems (known, unresolved)
1. **Test data pollution in the production DB.** Many `QA `-prefixed and similarly-named test fixtures exist in the live Neon database from this session's own test runs (some of which cleared the "real trending" evidence floor and briefly surfaced as a live trending claim). Not currently harmful — there are no real users yet — but should be cleaned up before real beta users arrive. No cleanup script has been written; this needs explicit confirmation before running any deletes against production data.
2. **The orphaned `ai_corrections` table** still exists in production Postgres (schema.sql no longer creates it on fresh deploys, but the existing table wasn't dropped). Harmless, just dead weight.
3. ~~The `llm.ts` optional AI recommendation-blurb layer~~ — **removed** (2026-09-04). It was a second, separate paid-API integration point from the already-removed vision code — inert (no `ANTHROPIC_API_KEY` set) but still live in the code. Deleted `server/src/llm.ts`, its wiring in `routes/recommendations.ts` (now just returns the deterministic template `reason` directly, no `reasonSource`/`llmConfigured` fields), the `@anthropic-ai/sdk` dependency, and the matching frontend/test references. All 93 tests still pass.
4. **No custom domain yet.** User is mid-purchase of `bhookmark.com` via Porkbun ($11.08/yr flat, verified pricing) — GitHub repo and code are already renamed; DNS + Vercel wiring is next once the purchase completes.

## Future tasks (not started, in rough priority order per the user's own stated interest)
- **The Bhookmark rename** (see "Exact next step" below) — explicitly requested, not yet begun.
- Custom domain purchase (user's action) + DNS wiring (my action, once they have a domain name).
- Phase 3: You-page progressive-disclosure redesign (`Profile.tsx` is still one flat scroll), Bhookmarks redesign (calendar, taste fingerprint, notes search), Bite Buddy / Taste Pulse (not built at all).
- Phase 4: Craving Rooms / Food Circles / Lists — all still fully mocked, zero real backend (push notifications are the one real piece already built).
- Phase 5 remainder: a full accessibility audit (44×44 targets, screen-reader pass, contrast) — the visual-redesign parity across Bhookmarks/Profile/Circles is now done.
- The formal manual QA click-through promised early in the project — done piecemeal via ad hoc testing across this whole session, never once as a single formal pass.
- Data export + account deletion workflow (Phase 2) — explicitly deferred by the user ("not needed for now, will see afterwards").

## Exact next step
The in-app rename is done and all 89 backend + 4 IP-isolation + 15 frontend tests pass against it. Remaining: rename the GitHub repo (`project-palate` → `bhookmark`) and the Vercel project slug, redeploy, and commit — then the custom domain purchase is next in line.

## Relevant files
- **Frontend core**: `src/screens/Home.tsx` (Crave/search, redesigned), `src/screens/LogFlow.tsx` (BiteLog, AI removed, privacy toggle added), `src/screens/Bhookmarks.tsx`, `src/screens/Profile.tsx` (venue-claim UI added), `src/screens/Duel.tsx`, `src/components/BrowseCard.tsx`, `src/smartPicks.ts`, `src/evidenceThresholds.ts`, `src/api.ts`
- **Backend core**: `server/src/app.ts` (trust proxy fix), `server/src/db.ts`, `server/src/routes/logs.ts` (ranking-manipulation signals, visibility), `server/src/routes/dishes.ts` (score separation, trending), `server/src/routes/venues.ts` (claims), `server/src/routes/moderation.ts` (claim review), `server/schema.sql`
- **Test suites** (all in `server/scripts/`, run against a real Neon DB): `redteam-smoke.mjs`, `recommendations-test.mjs`, `nearby-test.mjs`, `notifications-test.mjs`, `qa-brief-tests.mjs`, `venue-claims-test.mjs`, `privacy-visibility-test.mjs`, `ip-isolation-test.ts`, `concurrency-100.mjs`; frontend unit test: `scripts/evidence-thresholds-test.mjs` (repo root)

## Test status (as of last full run, this session)
**89 backend tests passing, 0 failing**, across 7 suites (13 + 11 + 7 + 7 + 24 + 16 + 11), plus 15 frontend unit tests and a 4-test IP-isolation suite — all green. Both frontend (`npx tsc -b`) and backend (`npx tsc --noEmit`) typecheck clean. Production deployed and verified healthy after every change this session.

**Known test-infra fragility, now fixed**: three test files previously drew fake IPs from small (250-address) reserved ranges for `X-Forwarded-For` spoofing; repeated same-day runs eventually accumulated enough history that a random draw would collide with itself and trip the real multi-account-network detector, producing false test failures. All three now draw from `10.0.0.0/8` (~16.7M addresses), where this is no longer practically possible.
