-- Bhookmark production schema (Neon Postgres). Run once via scripts/migrate.mjs.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  phone TEXT UNIQUE NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  dietary_profile TEXT NOT NULL DEFAULT 'no-restriction',
  allergens TEXT[] NOT NULL DEFAULT '{}',
  created_at BIGINT NOT NULL
);
-- Google Sign-In (real, free identity provider — added because phone OTP
-- has no SMS vendor wired up, and this project has a standing "no paid
-- APIs" rule). phone can no longer be required: a Google-only account has
-- none. google_sub is Google's own stable per-account identifier — the
-- correct join key, never the (changeable) email address.
ALTER TABLE users ALTER COLUMN phone DROP NOT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_sub TEXT UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT;

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

-- Both directions are inserted on acceptance so a lookup never needs an OR
-- across two columns. (Originally instant/no-consent on entering a code —
-- F02 in the 2026-09-08 brief flagged that as a real problem once phone
-- numbers were in the response too. friend_requests below is the fix:
-- entering a code now creates a pending request instead.)
CREATE TABLE IF NOT EXISTS friendships (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  friend_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, friend_id)
);

-- F02: consent step before two accounts become friends. One row per
-- request; the partial unique index below allows only one *pending*
-- request per unordered pair at a time (so concurrent/duplicate requests
-- from either side can't pile up — RED-03 in the brief), but still lets a
-- new request be sent later after a decline.
CREATE TABLE IF NOT EXISTS friend_requests (
  id TEXT PRIMARY KEY,
  sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | accepted | declined
  created_at BIGINT NOT NULL,
  responded_at BIGINT
);
CREATE INDEX IF NOT EXISTS idx_friend_requests_recipient ON friend_requests(recipient_id, status);
CREATE INDEX IF NOT EXISTS idx_friend_requests_sender ON friend_requests(sender_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_friend_request_pending ON friend_requests (
  LEAST(sender_id, recipient_id), GREATEST(sender_id, recipient_id)
) WHERE status = 'pending';

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

-- ===== Phase 2 (2026-09-11): real venue/dish catalog =====
-- Replaces the three hardcoded, drifting arrays (server/src/catalog.ts,
-- server/src/venues.ts, src/data/dishes.ts) that caused the "Coffee search
-- returns nothing" and "cafe X isn't in the app" bugs Phase 1 patched
-- around rather than fixed. `logs` deliberately stays free-text — this is
-- the discovery/browse/recommend layer, not a re-key of the evidence layer.

CREATE TABLE IF NOT EXISTS venues (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  area TEXT NOT NULL,
  city TEXT NOT NULL DEFAULT 'Bengaluru',
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  photo_url TEXT,
  photo_is_verified BOOLEAN NOT NULL DEFAULT false,
  source TEXT NOT NULL DEFAULT 'seed', -- 'seed' | 'osm' | 'user-submitted'
  osm_id TEXT, -- dedup key on re-fetch from Overpass; null for seed/user-submitted rows
  status TEXT NOT NULL DEFAULT 'active', -- 'active' | 'pending-review' | 'rejected' | 'merged'
  merged_into_id TEXT REFERENCES venues(id),
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
-- Guards against re-running a backfill twice, not a semantic dedup
-- guarantee — two real venues can share a name+area (different branches of
-- a chain), which is exactly why the Phase 2 plan requires a human to
-- confirm merges rather than matching on this index alone.
--
-- 2026-09-11: name+area alone turned out to collide constantly on real
-- OSM data — most OSM entries have no specific addr:suburb tag, so many
-- genuinely different locations of the same chain (8 separate real
-- "Indira Canteen" branches several km apart, multiple "Third Wave
-- Coffee" locations) all fell back to the same generic area string and
-- got rejected as if they were the same venue (474 of 1,291 real OSM
-- venues on the first real ingestion run). Rounding lat/lng to ~111m
-- (3 decimal places) distinguishes real distinct locations while still
-- catching a true accidental re-insert at the same spot.
DROP INDEX IF EXISTS uniq_venue_name_area;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_venue_name_area_location ON venues (lower(name), lower(area), round(lat::numeric, 3), round(lng::numeric, 3)) WHERE status <> 'merged';
CREATE UNIQUE INDEX IF NOT EXISTS uniq_venue_osm_id ON venues (osm_id) WHERE osm_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_venues_status ON venues(status);

CREATE TABLE IF NOT EXISTS dishes (
  id TEXT PRIMARY KEY,
  venue_id TEXT NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  category TEXT NOT NULL, -- always canonical (see category_aliases) — never a raw OSM cuisine tag or old string like "Filter Coffee"
  subtype TEXT NOT NULL,
  name TEXT NOT NULL,
  price_rs INT,
  photo_url TEXT,
  source TEXT NOT NULL DEFAULT 'seed', -- 'seed' | 'user-submitted' | 'user-logged' (first real log at a bare OSM venue creates one)
  status TEXT NOT NULL DEFAULT 'active',
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_dish_identity ON dishes (venue_id, category, subtype, lower(name)) WHERE status <> 'merged';
CREATE INDEX IF NOT EXISTS idx_dishes_venue ON dishes(venue_id);
CREATE INDEX IF NOT EXISTS idx_dishes_category_subtype ON dishes(category, subtype);

-- Diet/allergen attributes WITH PROVENANCE — replaces catalog.ts's static
-- dietTags[]/allergens[] booleans. Multiple rows per dish are expected
-- (seed says "dairy", a later user report says "gluten too") — nothing
-- here overwrites in place, so one bad report can be rejected without
-- losing the rest.
CREATE TABLE IF NOT EXISTS dish_attributes (
  dish_id TEXT NOT NULL REFERENCES dishes(id) ON DELETE CASCADE,
  attribute TEXT NOT NULL, -- 'diet:veg' | 'diet:vegan' | 'diet:egg' | 'diet:non-veg' | 'allergen:dairy' | 'allergen:gluten' | 'allergen:nuts' | ...
  source TEXT NOT NULL, -- 'seed-catalog' | 'venue-claim' | 'user-report' | 'moderator'
  reported_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  checked_at BIGINT NOT NULL,
  PRIMARY KEY (dish_id, attribute, source)
);
CREATE INDEX IF NOT EXISTS idx_dish_attributes_dish ON dish_attributes(dish_id);

-- Alias tables so a category/spelling only ever has to be correct in ONE
-- place — the exact bug that broke Coffee search (frontend said "Coffee",
-- server venues still said "Filter Coffee") structurally can't happen
-- again once /venues/nearby resolves through this instead of exact-match.
CREATE TABLE IF NOT EXISTS category_aliases (
  alias TEXT PRIMARY KEY, -- lowercase, e.g. 'filter coffee', 'kaapi', 'pav bhaji'
  category TEXT NOT NULL -- canonical, e.g. 'Coffee', 'Street Food & Chaat'
);
CREATE TABLE IF NOT EXISTS dish_name_aliases (
  alias TEXT PRIMARY KEY, -- lowercase, e.g. 'dose', 'biriyani'
  canonical_token TEXT NOT NULL -- widens a search match only, e.g. 'dosa', 'biryani'
);

-- Lightweight new-venue/new-dish submission — same cheap-submit/
-- moderator-approves shape as the existing venue_claims table, for
-- whatever the OSM ingestion (Phase 2, next session) genuinely doesn't
-- have. Submitting stays cheap; the trust boundary is entirely at
-- approval, same philosophy as venue_claims.
CREATE TABLE IF NOT EXISTS venue_submissions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  area TEXT NOT NULL,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  category TEXT NOT NULL,
  subtype TEXT,
  dish_name TEXT,
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected
  resulting_venue_id TEXT REFERENCES venues(id),
  created_at BIGINT NOT NULL,
  reviewed_at BIGINT
);
CREATE INDEX IF NOT EXISTS idx_venue_submissions_status ON venue_submissions(status);
