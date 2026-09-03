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
  last_seen_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_devices_user ON devices(user_id);

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
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_logs_user ON logs(user_id);
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

-- Passive eval log for AI dish-recognition corrections (brief 1.3): stores
-- what the model suggested vs. what the user actually confirmed/changed.
-- Never read back into the detection path automatically — eval-only.
CREATE TABLE IF NOT EXISTS ai_corrections (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ai_suggestion JSONB NOT NULL,
  user_correction JSONB NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_corrections_created ON ai_corrections(created_at);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  PRIMARY KEY (user_id, endpoint)
);
