# Trust & safety — what's real, mapped to Section 13

## Evidence ladder (implemented, simplified)
`server/src/routes/logs.ts` computes one of four levels from client-reported
signals: `declared`, `visit-consistent`, `live-capture`, `transaction-supported`.
This is the real shape of Section 13's ladder, minus two levels the doc
specifies that aren't implemented:

- **Behavior-earned** (account history consistency) — not implemented. Would
  need real historical-pattern analysis across many users, which a
  single-server in-memory prototype with a handful of test accounts can't
  meaningfully demonstrate.
- The "live-capture" and "visit-consistent" checks currently trust the
  client's `livePhoto`/`liveLocationMatch` booleans outright. A real system
  verifies these server-side (actual EXIF/timestamp check, actual GPS
  cross-reference against the venue) — there's no real camera or GPS pipeline
  here to verify against yet, so this is an honest gap, not an oversight.

## Integrity controls (implemented, naive by design)
- **Velocity/burst detection**: per `(deviceId, venue)` in a 10-minute window,
  more than 5 logs holds the 6th+ for review (`isBurst` in `logs.ts`). This is
  deliberately the simplest possible version of Section 13's multi-signal
  detection (device + network + text-similarity + image-hash + graph) — it
  catches the smoke test's obvious burst and nothing subtler.
- **Perceptual-image-hash duplicate detection**: not implemented — there's no
  real image upload in this prototype, so there's nothing to hash.
- **Text-similarity clustering** (paraphrased review campaigns): not
  implemented — would need an actual corpus of free-text reviews and an
  embedding/similarity pipeline.

## Progressive enforcement (implemented, minimal)
`published → held → removed`, with moderator-only routes to move between
them. The doc's full ladder (label, limit reach, request evidence, suspend,
appeal) isn't built — this prototype only demonstrates the core
publish/hold/remove mechanism and that it's deny-by-default to non-moderators
(verified in the smoke test).

## What would make this real
A real image pipeline (so photo evidence and duplicate-hash detection mean
something), a persistent database with enough real accounts to make
behavior-earned trust meaningful, and a genuine moderator console instead of
raw API routes. None of that is a weekend of coding — it's the actual
product.
