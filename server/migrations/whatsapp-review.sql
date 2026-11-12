-- REVIEW DATABASE ONLY. Not applied automatically, and not a production launch migration.
-- No users/phone-account binding and no food mutations are introduced here.
CREATE TABLE IF NOT EXISTS whatsapp_review_quota (
  phone_id text NOT NULL,
  month text NOT NULL CHECK (month ~ '^[0-9]{4}-[0-9]{2}$'),
  reserved integer NOT NULL DEFAULT 0 CHECK (reserved BETWEEN 0 AND 900),
  PRIMARY KEY (phone_id, month)
);
CREATE TABLE IF NOT EXISTS whatsapp_review_inbox (
  phone_id text NOT NULL,
  message_id text NOT NULL,
  received_at bigint NOT NULL,
  PRIMARY KEY (phone_id, message_id)
);
CREATE TABLE IF NOT EXISTS whatsapp_review_outbox (
  phone_id text NOT NULL,
  message_id text NOT NULL,
  recipient text NOT NULL,
  reply text NOT NULL CHECK (char_length(reply) BETWEEN 1 AND 4000),
  expires_at bigint NOT NULL,
  mode text NOT NULL DEFAULT 'dry-run' CHECK (mode = 'dry-run'),
  PRIMARY KEY (phone_id, message_id),
  FOREIGN KEY (phone_id, message_id) REFERENCES whatsapp_review_inbox(phone_id, message_id)
);
-- Future retention job must remove expired outbox bodies/recipients, while
-- retaining deduplication tombstones through the provider retry horizon.
-- No scheduler, sending worker or migration runner is installed by this file.
