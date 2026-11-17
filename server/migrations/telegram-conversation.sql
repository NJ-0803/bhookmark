-- Telegram beta safety migration. NOT applied automatically. Review and apply to an isolated
-- staging database first; the live database is a separate, explicit decision.
-- Idempotent: safe to run twice.

-- 1. whatsapp-review.sql capped reserved at 900, which is below the Telegram default monthly cap
--    (TELEGRAM_MONTHLY_REPLY_CAP, 20000). Without this, the 901st reply in a month fails the CHECK
--    and every message after it errors instead of being refused cleanly.
ALTER TABLE whatsapp_review_quota DROP CONSTRAINT IF EXISTS whatsapp_review_quota_reserved_check;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_review_quota_reserved_nonneg') THEN
    ALTER TABLE whatsapp_review_quota ADD CONSTRAINT whatsapp_review_quota_reserved_nonneg CHECK (reserved >= 0);
  END IF;
END $$;

-- 2. In-progress save conversation, one row per Telegram sender. Rows expire after 10 minutes
--    (enforced in code on read); STOP/UNLINK deletes the row.
CREATE TABLE IF NOT EXISTS tg_conversations (
  phone_id text NOT NULL,
  sender text NOT NULL,
  state jsonb NOT NULL,
  expires_at bigint NOT NULL,
  PRIMARY KEY (phone_id, sender)
);

-- 3. Per-sender message counters (minute and day buckets) for fair use. Stale buckets are
--    deleted by the sender's own next message.
CREATE TABLE IF NOT EXISTS whatsapp_sender_window (
  phone_id text NOT NULL,
  sender text NOT NULL,
  bucket text NOT NULL,
  count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (phone_id, sender, bucket)
);
