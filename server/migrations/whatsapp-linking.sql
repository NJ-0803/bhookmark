-- Apply only to the same isolated review database as whatsapp-review.sql.
CREATE TABLE IF NOT EXISTS whatsapp_link_intents (
  user_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  token_hash text UNIQUE NOT NULL,
  expires_at bigint NOT NULL,
  sender text,
  confirmation_hash text,
  confirmed boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS whatsapp_links (
  sender text PRIMARY KEY,
  user_id text UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  linked_at bigint NOT NULL
);
CREATE TABLE IF NOT EXISTS whatsapp_execution_events (
  phone_id text NOT NULL,
  message_id text NOT NULL,
  user_id text,
  reply text NOT NULL,
  PRIMARY KEY(phone_id,message_id)
);
CREATE TABLE IF NOT EXISTS whatsapp_undo (
  token text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bookmark_id text NOT NULL,
  before_value jsonb,
  after_value jsonb NOT NULL,
  expires_at bigint NOT NULL,
  consumed boolean NOT NULL DEFAULT false
);
