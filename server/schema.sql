-- Bhookmark production schema (Neon Postgres). Run once via scripts/migrate.mjs.

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
  owner_disclosed BOOLEAN NOT NULL DEFAULT false,
  visibility TEXT NOT NULL DEFAULT 'public'
);
CREATE INDEX IF NOT EXISTS idx_logs_user ON logs(user_id);
-- Added after logs already existed in production.
ALTER TABLE logs ADD COLUMN IF NOT EXISTS location_verified BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE logs ADD COLUMN IF NOT EXISTS owner_disclosed BOOLEAN NOT NULL DEFAULT false;
-- Privacy visibility levels (brief Phase 2: "private diary" option) —
-- public is the default because this app's core loop is a shared community
-- score, not a private-first journal (unlike the brief's generic default,
-- this is a deliberate product call, not an oversight) — private is an
-- explicit opt-in per log, never silently applied.
ALTER TABLE logs ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'public';

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

-- Phase 4: real Circles backend (Craving Rooms, Food Circles, Lists),
-- replacing what was previously 100% hardcoded mock data in the frontend.

-- A permanent, personal code (like a game friend code) — the base identity
-- layer everything else builds on. Backfilled lazily on first request for
-- existing users rather than in this migration (a bulk ALTER can't assign a
-- distinct random value per existing row in one statement).
ALTER TABLE users ADD COLUMN IF NOT EXISTS friend_code TEXT UNIQUE;

-- Adding a friend by code is instant and mutual (no pending-request step,
-- matching "just like adding a friend in a game") — both directions are
-- inserted so a lookup never needs an OR across two columns.
CREATE TABLE IF NOT EXISTS friendships (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  friend_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, friend_id)
);

-- Food Circles: a standing group, built from a user's existing friends
-- (not a separate invite code) since the group is meant to persist.
CREATE TABLE IF NOT EXISTS circles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  creator_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS circle_members (
  circle_id TEXT NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at BIGINT NOT NULL,
  PRIMARY KEY (circle_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_circle_members_user ON circle_members(user_id);

-- Craving Rooms: a disposable, short-lived session (not built from friends
-- — the point is being able to loop in anyone with the room's own code,
-- e.g. people you're physically with who aren't in your friends list yet).
CREATE TABLE IF NOT EXISTS craving_rooms (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  creator_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mood TEXT NOT NULL,
  radius_km INT NOT NULL,
  status TEXT NOT NULL DEFAULT 'setup',
  candidate_ids TEXT[] NOT NULL DEFAULT '{}',
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL
);
-- Every participant must swipe on the exact same dish list for "everyone
-- agreed" to mean anything — set once by the creator, fetched by joiners
-- rather than each client independently guessing the same candidates.
ALTER TABLE craving_rooms ADD COLUMN IF NOT EXISTS candidate_ids TEXT[] NOT NULL DEFAULT '{}';
CREATE TABLE IF NOT EXISTS craving_room_participants (
  room_id TEXT NOT NULL REFERENCES craving_rooms(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at BIGINT NOT NULL,
  PRIMARY KEY (room_id, user_id)
);
CREATE TABLE IF NOT EXISTS craving_room_swipes (
  room_id TEXT NOT NULL REFERENCES craving_rooms(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  dish_id TEXT NOT NULL,
  liked BOOLEAN NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (room_id, user_id, dish_id)
);
CREATE INDEX IF NOT EXISTS idx_craving_rooms_code ON craving_rooms(code);

-- Lists: user-curated, clonable/remixable — parent_list_id links a clone
-- back to the original so a real clone count is just a COUNT(*) query.
CREATE TABLE IF NOT EXISTS lists (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_list_id TEXT REFERENCES lists(id) ON DELETE SET NULL,
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS list_items (
  id SERIAL PRIMARY KEY,
  list_id TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  dish_name TEXT NOT NULL,
  venue TEXT NOT NULL,
  position INT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_list_items_list ON list_items(list_id);
CREATE INDEX IF NOT EXISTS idx_lists_parent ON lists(parent_list_id);
