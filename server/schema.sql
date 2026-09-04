-- Palate production schema (Neon Postgres). Run once via scripts/migrate.mjs.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  phone TEXT UNIQUE NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  dietary_profile TEXT NOT NULL DEFAULT 'no-restriction',
  allergens TEXT[] NOT NULL DEFAULT '{}',
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS otps (
  phone TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  expires_at BIGINT NOT NULL,
  attempts INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  family_id TEXT NOT NULL,
  label TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  last_seen_at BIGINT NOT NULL,
  ip TEXT
);
CREATE INDEX IF NOT EXISTS idx_devices_user ON devices(user_id);
-- Added after the table already existed in production — ADD COLUMN IF NOT
-- EXISTS keeps this migration idempotent for both fresh and existing DBs.
ALTER TABLE devices ADD COLUMN IF NOT EXISTS ip TEXT;
CREATE INDEX IF NOT EXISTS idx_devices_ip ON devices(ip);

CREATE TABLE IF NOT EXISTS refresh_families (
  family_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  current_jti TEXT NOT NULL,
  revoked BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  subtype TEXT NOT NULL,
  name TEXT NOT NULL,
  venue TEXT NOT NULL,
  verdict TEXT NOT NULL,
  score REAL NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  evidence_level TEXT NOT NULL,
  verified BOOLEAN NOT NULL,
  status TEXT NOT NULL,
  device_id TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  location_verified BOOLEAN NOT NULL DEFAULT false,
  owner_disclosed BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_logs_user ON logs(user_id);
-- Added after logs already existed in production.
ALTER TABLE logs ADD COLUMN IF NOT EXISTS location_verified BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE logs ADD COLUMN IF NOT EXISTS owner_disclosed BOOLEAN NOT NULL DEFAULT false;

-- Ranking-manipulation control (brief 1.5: "repeated delete-and-repost
-- behaviour"). Deliberately separate from the logs table itself — a log
-- row is gone once deleted, but the pattern of deleting and reposting at
-- the same venue is exactly what needs to survive that deletion to detect.
CREATE TABLE IF NOT EXISTS log_deletions (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  venue TEXT NOT NULL,
  category TEXT NOT NULL,
  subtype TEXT NOT NULL,
  name TEXT NOT NULL,
  deleted_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_log_deletions_lookup ON log_deletions(user_id, venue, deleted_at);
CREATE INDEX IF NOT EXISTS idx_logs_venue_category ON logs(venue, category, status);
CREATE INDEX IF NOT EXISTS idx_logs_status ON logs(status);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  key TEXT PRIMARY KEY,
  status INT NOT NULL,
  body JSONB NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS venue_velocity (
  key TEXT PRIMARY KEY,
  hits BIGINT[] NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS security_events (
  id SERIAL PRIMARY KEY,
  type TEXT NOT NULL,
  detail TEXT NOT NULL,
  at BIGINT NOT NULL
);

-- Restaurant-staff self-rating disclosure (brief 1.5). A claim is manually
-- reviewed in the moderation queue — there's no automated ownership
-- verification (no business-registry integration), so a human approves it,
-- same as the held-log review queue already does.
CREATE TABLE IF NOT EXISTS venue_claims (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  venue TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at BIGINT NOT NULL,
  reviewed_at BIGINT
);
CREATE INDEX IF NOT EXISTS idx_venue_claims_venue ON venue_claims(venue, status);
CREATE INDEX IF NOT EXISTS idx_venue_claims_user ON venue_claims(user_id);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  PRIMARY KEY (user_id, endpoint)
);
