-- Telegram beta safety migration. NOT applied automatically. Review it, then apply to an isolated
-- staging database first; applying it to the live database is a separate, explicit decision.
-- Idempotent: safe to run twice. Nothing here is required while the new Telegram flags are off.

-- 1. whatsapp-review.sql defines CHECK (reserved BETWEEN 0 AND 900) on whatsapp_review_quota.
--    The Telegram monthly cap defaults to 20000 (TELEGRAM_MONTHLY_REPLY_CAP, code maximum 100000), so a
--    database created from that file would reject the 901st reservation in a month. Replace that
--    check with a non-negative check. Constraints are found by definition, not by generated name.
DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
    WHERE conrelid = 'whatsapp_review_quota'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) ~ 'reserved' AND pg_get_constraintdef(oid) ~ '900'
  LOOP
    EXECUTE format('ALTER TABLE whatsapp_review_quota DROP CONSTRAINT %I', c.conname);
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'whatsapp_review_quota'::regclass AND conname = 'whatsapp_review_quota_reserved_nonneg') THEN
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

-- 4. A redelivered Telegram update must get the same buttons back, not just the text.
ALTER TABLE whatsapp_execution_events ADD COLUMN IF NOT EXISTS buttons jsonb;
