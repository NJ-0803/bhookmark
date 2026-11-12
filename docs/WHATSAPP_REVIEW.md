# Direct WhatsApp preparation (review only)

This branch now contains a direct-Meta **webhook transport foundation**, not a working public WhatsApp bot. No Meta account, number, credentials, subscriptions or payment method was created. Nothing has been deployed. Production always returns 404 for this adapter, even if its flag is set.

## Try without a Meta account

Use Node 22+ and the review branch, then:

```sh
npm ci
npm run demo:whatsapp
```

This terminal simulator creates a temporary isolated PostgreSQL-compatible database, starts a loopback HTTP server, signs fictional Meta-shaped text events, and reads the resulting dry-run replies. It demonstrates a valid signature, a forged signature, a duplicate event and a shared two-reply test cap. It exits and removes its temporary data. It does not use `DATABASE_URL`, `.env`, an access token, the Graph API or your saved food. Do not use its clearly fictional credentials outside this demo.

The separate visual conversation demo is still `npm run demo:chat` at `http://127.0.0.1:4040` on your own computer. It is also sample-data/read-only. Neither demo sends WhatsApp messages or saves ratings.

## What was added

- `GET /whatsapp/webhook`: Meta subscription challenge, with a separate verification token. Not authorization for message processing.
- `POST /whatsapp/webhook`: SHA256 HMAC of the exact raw request body, checked before JSON parsing with constant-time digest comparison. Bound to the configured WhatsApp account and business phone-number ID. No client-asserted Bhookmark identity accepted.
- Text only, 2,000-character limit. Media and delivery-status notifications do not generate replies. No fetching of URLs supplied in a message. No group support or free-form AI instruction execution.
- Messages older than 23 hours, or over a minute in the future, generate no reply. Each draft expires 24 hours after the originating user's message timestamp. This intentionally conservative review version does not track a later message extending a window.
- Durable dry-run inbox/outbox and shared monthly quota, using a PostgreSQL transaction, quota-row lock and unique event key. Retries cannot queue the same reply twice, including across month rollover. A failure rolls back the whole transaction so Meta can retry. A capped event is recorded but not queued and is not automatically replayed later.
- Default maximum 900 reserved replies per phone number/month, shared across recipients. The configurable maximum is 900, leaving headroom below Meta's 1,000 allowance. This is a conservative reservation counter, NOT Meta's delivered-message billing counter. There is no sending worker, network sender, access-token setting or automatic retry of outbound messages in this version.
- Default reply refuses account access because linking is not enabled. The simulator injects fictional preview data explicitly; the server's normal route never derives a user account from sender/profile/contact information.

The webhook responds only with mode/status, never reply text or private account data. Errors do not echo secrets or payloads. Integration is before the ordinary JSON parser because reserialized JSON is not valid evidence of the signed bytes.

## Optional isolated-server review settings

The simulator needs none of these. For a reviewer intentionally exercising the normal development server with a disposable database, first review and apply `server/migrations/whatsapp-review.sql` **only to that disposable database**. Supply secrets through secure environment configuration, never commit them. Leave the flag off otherwise.

```text
BHOOKMARK_WHATSAPP_REVIEW=0
WHATSAPP_APP_SECRET=
WHATSAPP_VERIFY_TOKEN=
WHATSAPP_ACCOUNT_ID=
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_REVIEW_REPLY_CAP=900
WHATSAPP_ACCOUNT_TIMEZONE=UTC
```

App secret and verification token must each be at least 32 characters. The account/number IDs must be numeric. Set the timezone to match the intended Meta messaging account before testing monthly boundaries. This configuration does not authorize connecting a real number or exposing a public webhook. No migrations run on server startup. The older refresh-family migration also remains required before any future release of this branch.

## What remains before a public pilot

1. Owner-approved Meta business/app/number onboarding, then secure credential configuration, policy eligibility and permissions verification. Do not reuse sample credentials or informal WhatsApp Web automation.
2. Two-sided, expiring account-link handshake: a recent authenticated Bhookmark session, proof from the WhatsApp sender, explicit account confirmation, single-use hashed tokens, revocation and rate limiting. A phone number alone is not account ownership.
3. Transactional food execution, per-user serialization and conflict checks, explicit confirmations and safe undo. The existing preview engine proposes changes only.
4. Outbound worker using the direct Graph API; delivery-status reconciliation; immediate pre-send window/quota checks; opt-out and recipient limits; an account-wide cap consistent with all other sends from the number. Never mistake API acceptance for delivery. Timeouts can have uncertain send outcomes: do not blindly resend.
5. Secure retention/cleanup, monitoring, and abuse controls. Review tables contain recipient/reply data; they are not a production privacy design. Keep event tombstones for the provider retry horizon while removing expired private bodies. No cleanup job is installed here.
6. Cap warning and website fallback BEFORE exhaustion, not silent loss of saves. Reservations cannot guarantee Meta billing limits if another app/operator also uses the number. No paid fallback is authorized.
7. Full sandbox end-to-end testing and migration review, then a separate explicit deployment decision. Passing unit tests is not production approval.

## Pricing basis checked November 12, 2026

Direct Cloud API has no extra platform-access fee. Meta does not charge incoming user messages. The first **1,000 delivered service replies per business phone number/month** are free, shared across users; unused allowance does not roll over. A 24-hour customer service window permits non-template replies, but no longer makes unlimited replies free. The current INR list rate for service messages to India numbers beyond the allowance is INR0.115 each, before tax. Other recipient markets/billing currencies differ. Templates, proactive messages and Meta Business Agent are not covered by this service allowance.

This code does not create an account or consume that allowance. Hosting, database, phone-number costs and optional AI are separate. The narrow parser needs no paid AI API. Existing hosting free-tier capacity has not been verified. A paid intermediary can add fees even when Meta messages are free. Pricing can change; recheck before launch.

Current owning sources (the older `/docs/whatsapp/pricing` page still showed the earlier unlimited-free wording at this check):

- https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing
- https://whatsappbusiness.com/resources/faq/
- https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/non-template-messages/
- https://developers.facebook.com/docs/graph-api/webhooks/getting-started/
- https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/overview/
- https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages/

No live migration, deployment, paid setup or real WhatsApp send is part of this change.
