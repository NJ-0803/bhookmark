# Conversational Bhookmark: first review slice

This branch adds a channel-neutral **read-only preview** for food-save/rating messages. It does not connect WhatsApp, Apple Messages, SMS, Telegram or any AI provider. It does not write bookmarks or link phone identities. Production behavior stays disabled even when the preview flag is set.

## Try locally

Use an isolated development database, never a production database. Follow the existing README to run the API and sign into your local Bhookmark account. Add `BHOOKMARK_CHAT_PREVIEW=1` to local environment settings and leave `NODE_ENV` non-production. POST JSON to `/chat/preview` with your local account's existing Bearer access token:

```json
{ "message": "Had pizza at Toit Indiranagar, 8.5/10" }
```

The response has `mode: "preview"`, `writesEnabled: false`, and either a proposal, personal-list response, or clarification. No “confirm” command executes it. No token or secret should go into a shared screenshot or issue.

Supported grammar:
- `Save pizza at Toit Indiranagar`
- `Had pizza at Toit Indiranagar, 8.5/10`
- `Had pizza at Toit Indiranagar`
- `Show my saves`
- `What dishes did I like at Toit Indiranagar?`

Recall returns rated items in score order, including low scores; it does not invent a “liked” threshold. This is a narrow deterministic parser, not unrestricted natural-language AI. A clarification includes up to five branch choices; resubmit with the full branch name, not a choice number. Only local restaurant search is used, so preview does not invoke optional paid Places search. Missing venues need the existing manual web save flow for now.

Existing ratings remain nullable and manually chosen, from 0 to 10 in 0.5 steps, only for tried food. Re-saving an existing dish proposes an update rather than a duplicate insert, preserves notes/reference links and does not erase a score or tried status. Every read uses the authenticated account, never an asserted user ID in message text or JSON.

Run `npm test`, `npm run build`, `npm run typecheck:server`, and `npm run lint`. Tests use mocked search/store data for chat and the existing isolated PostgreSQL harness for bookmark invariants. No production database or paid service is used by those tests.

## Before connecting a messaging channel

- Select the public business channel/provider and verify current fees/approval/India coverage. No provider chosen or paid account created here.
- Verify provider webhook signatures over its required payload representation. Add raw-body/form handling as required; don't expose the preview as a public unauthenticated webhook.
- Add persistent, unique provider+sender-to-user links. Require both verified chat control and authenticated account consent through expiring, single-use challenges. Never merge by typed email or a phone string alone. Provide unlink/revoke.
- Store provider message deduplication, clarification state, operation results and outbound replies durably. Current serverless hosting cannot rely on in-memory state. Serialize edits and reconcile retries before writing.
- Execute validated proposals through the same user-scoped bookmark store, preserving values during updates. An authenticated preview is not a trusted public-channel sender resolver.
- Add edit/undo backed by prior state. Undo of an update restores prior data rather than deleting a previously saved item.
- Add tests for forged callbacks, duplicate deliveries, link replay and expiry, identity takeover, cross-account access, failed writes and retry/undo behavior.
- The data model is one current bookmark per dish+branch, not repeated dated meal logs. A meal history is a separate product/database change.
- There is deliberately no new Vercel rewrite or deployment step for this local preview. No schema migration is needed for this slice.

## Scope and checks

Source baseline: c4d209870d938f1e12eac8f876547dfee1a82e9d. Existing application/package versions were left unchanged. Dependency auditing reported existing advisories including high/critical transitive dependencies; this branch does not claim to fix them or that production is security-audited. Review current audit results before release.
