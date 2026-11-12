# Focused corrective review - November 12, 2026

Changes are for review on `feature/chat-preview`, not proof of a production security assessment. No live database, settings or deployment was modified. Baseline: c4d209870d938f1e12eac8f876547dfee1a82e9d.

## Corrected here

- Updated compatible dependency ranges/locks in both root and server installations. The registry/advisory checks initially reported eight vulnerable dependency entries in the root, including proxy-addr, body-parser, Zod and dev tooling. Both installations now report zero known advisories at the check time. Advisory severity is not a proof of application-specific exploitability. No major-version upgrades or npm overrides were used.
- Pin JWT verification to HS256 and validate signed payload fields. Refresh tokens now carry the original authentication timestamp. Old tokens without it use 0, so refreshing cannot make an old session pass a future recent-auth requirement.
- Rotate refresh tokens with a conditional database update. Only one request wins. Reject conflicts with HTTP 409 without minting a token or revoking the winning family. For 30 seconds after a rotation, stale tokens are rejected as conflicts; after that, stale reuse revokes the family as before. This grace trades immediate replay-triggered revocation for tolerance of overlapping legitimate requests; it never accepts a stale token. A lost winning response may still require a new login. The client does not erase stored sessions on a 409 conflict. No claim of seamless cross-tab recovery is made.
- Require `email_verified` on the Google identity before creating a session. Stable Google subject remains the join key, never typed email.
- Validate/normalize phone keys before OTP rate limiting. Invalid phone bodies share the IP bucket rather than supplying arbitrary rate keys. The unconfigured SMS path no longer writes a code it cannot send.
- Limit reference URLs to 2,000 characters, as the UI already does.
- Replace wildcard `*.vercel.app` CORS permission with explicit `ALLOWED_ORIGINS`. Same-origin frontend needs no entry; local development permits localhost ports. Preview domains must be listed explicitly when cross-origin access is intended.
- Disable forwarded-header trust by default for self-hosted Node. On Vercel (`VERCEL=1`), trust the immediate platform edge; Vercel documents that incoming X-Forwarded-For is overwritten. Other deployments can specify explicit `TRUST_PROXY_CIDRS`. Never enable trust-all on an internet-reachable direct server.

## Migration / release conditions

Before deploying this branch, review and run the additive migration for nullable `refresh_families.previous_jti` and `rotated_at`. Existing rows stay usable with null values. This branch's local tests use an isolated in-process database; **the production migration was not run**.

Vercel documentation, checked November 12:
- https://vercel.com/docs/headers/request-headers
- https://vercel.com/kb/guide/how-to-build-a-honeypot-with-vercel-web-application-firewall

The old trust-all setting is empirically unsafe on a generic direct Express server. Vercel's documented header overwrite prevents treating that reproduction as proof of an exploitable live Vercel bypass. Actual production upstream proxies/Enterprise trusted-proxy settings are unverified. Review this boundary if moving hosts or adding a CDN. Do not copy a numeric hop count to another topology without checking it.

## Remaining limits

Rate-limit MemoryStore counters are per process/instance, not a global abuse or spending cap. OTP attempt counters remain non-atomic legacy logic; production SMS is not configured, so do not enable it without addressing durable attempts, delivery and replay protection. Optional Google Places requires billing quotas. No new messaging webhook, phone account-linking, message execution, retry outbox or undo path is enabled by the chat preview. Those require their own implementation and tests before launch.

The standalone local demo uses fictional fixtures and does not connect to the production app or store. Client build, server typecheck, lint and isolated tests are automated checks, not an end-to-end live login test or penetration test. Existing Fast Refresh lint warning in CardStage.tsx remains; no unrelated UI rewrite was made.

## Follow-up: legacy-schema refresh compatibility

The subsequent linking change removes the runtime dependency on `previous_jti` and `rotated_at`. Atomic rotation updates only the existing `current_jti` column. New unpredictable signed JTIs encode their rotation timestamp (`rotation.<milliseconds>.<21 random characters>`), so stale tokens still receive a 30-second reject-without-revocation conflict grace. Stale tokens are never exchanged. After that grace replay revokes as before; original authentication time is retained. Optional older columns are tolerated but not required. Regression tests cover a legacy refresh table without either column. No live migration was run. This supersedes earlier statements in this review that the refresh migration must precede deployment. It does not authorize or prove readiness for a production deployment.
