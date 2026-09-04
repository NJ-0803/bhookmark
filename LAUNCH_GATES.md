# Launch gates — real status

Maps the doc's Section 18 gates to what's actually built vs. what still
needs a real decision, a paid vendor, or legal review before it can move
past "designed" to "executed." Updated by hand — this is not generated from CI.

## Gate 0A — Concept prototype
**Status: built.** Duel, BiteLog, Bhookmarks journal (with empty state), Craving
Room, category→subtype funnel, dish profile. Client-side only when this gate
was first built; now backed by the real API below.
**Not yet done:** the 20-user phone test from the doc's exit criteria. Nothing
here substitutes for putting it in front of real people.

## Gate 0B — Motion & accessibility
**Status: partial.** Tab transitions, duel-round transitions, and the score
reveal use framer-motion and respect `prefers-reduced-motion` (global CSS
override in `index.css`). **Not done:** no frame-time budget measurement on a
real mid-range Android device, no screen-reader pass, no low-end glass
fallback test (the bottom nav uses `backdrop-blur`, unverified degrade path).

## Gate 1 — Closed MVP
**Status: partial, real backend now exists.** Phone-OTP auth, rate limiting,
refresh-token rotation with reuse detection, object-level authorization on
logs, idempotency keys, and an evidence-ladder trust model are implemented
and covered by `server/scripts/redteam-smoke.mjs` (13/13 passing as of this
write-up). **Not done:** private circles are UI-only mock data, not backed by
real membership; there's no persistent database (everything is in-memory —
restarting the server wipes it); no production secrets management (JWT
secrets are hardcoded dev strings).

## Gate 1.5 — Trust beta
**Status: skeleton only.** A moderation queue (`/moderation/queue`,
`/logs/:id/release|remove`) and a naive per-venue velocity hold exist and are
smoke-tested. **Not done:** no perceptual-image-hash duplicate detection (no
real image upload pipeline yet), no text-similarity clustering, no owner
claim/reply flow, no appeals workflow, no real moderator console UI (only
raw API routes).

## Gate 2 — Public Bangalore
**Not started.** AI auto-tagging in the app is a client-side mock (a fixed
list of guesses), not a real vision model call. Taste Receipts, city quests,
and the controlled social feed are either UI mockups or not built.

## Gate 3 — Scale
**Not started, and can't be "executed" locally.** See `SCALE_NOTES.md` — this
gate requires real cloud infrastructure, a real database, and paid load-testing
tooling. No amount of local work substitutes for that.

## Gate 4 — Youth expansion
**Not started, intentionally.** Requires legal review of India's DPDP Act
child-data obligations before any code decision is meaningful. This is not a
coding task.
