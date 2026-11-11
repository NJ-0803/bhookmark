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

-- Additive refresh concurrency protection. Apply before deploying this branch.
ALTER TABLE refresh_families ADD COLUMN IF NOT EXISTS previous_jti TEXT;
ALTER TABLE refresh_families ADD COLUMN IF NOT EXISTS rotated_at BIGINT;

CREATE TABLE IF NOT EXISTS security_events (
  id SERIAL PRIMARY KEY,
  type TEXT NOT NULL,
  detail TEXT NOT NULL,
  at BIGINT NOT NULL
);


-- Legacy saved dishes are retained solely to migrate existing wishlists.
CREATE TABLE IF NOT EXISTS saved_dishes (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  dish_key TEXT NOT NULL,
  name TEXT NOT NULL,
  venue TEXT NOT NULL,
  area TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  subtype TEXT NOT NULL DEFAULT '',
  created_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, dish_key)
);
CREATE INDEX IF NOT EXISTS idx_saved_dishes_user ON saved_dishes(user_id, created_at DESC);


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


-- Restaurant wishlist pivot: new private saves, branch-specific identity.
CREATE TABLE IF NOT EXISTS food_bookmarks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  restaurant_id TEXT NOT NULL,
  restaurant_name TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  reference_url TEXT NOT NULL DEFAULT '',
  tried BOOLEAN NOT NULL DEFAULT false,
  rating NUMERIC(3,1),
  created_at BIGINT NOT NULL,
  CHECK (rating IS NULL OR (tried AND rating BETWEEN 0 AND 10 AND mod(rating, 0.5) = 0))
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_food_bookmark ON food_bookmarks
  (user_id, restaurant_id, (lower(regexp_replace(trim(name), '[[:space:]]+', ' ', 'g'))));
CREATE INDEX IF NOT EXISTS idx_food_bookmarks_user ON food_bookmarks(user_id, created_at DESC);
-- Carry forward saved dishes only. Old score/log data is intentionally not
-- imported: historical scores cannot be reliably classified as manual.
CREATE TABLE IF NOT EXISTS wishlist_legacy_imports (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  dish_key TEXT NOT NULL,
  PRIMARY KEY (user_id, dish_key)
);
-- Remember each import even if the user subsequently removes its bookmark.
-- Re-running a migration must not resurrect removed saved items.
WITH legacy AS (
  SELECT s.* FROM saved_dishes s WHERE NOT EXISTS (
    SELECT 1 FROM wishlist_legacy_imports m WHERE m.user_id = s.user_id AND m.dish_key = s.dish_key
  )
), imported AS (
  INSERT INTO food_bookmarks (id, user_id, restaurant_id, restaurant_name, address, name, created_at)
  SELECT 'saved-' || md5(user_id || dish_key), user_id,
    'legacy:' || md5(lower(trim(venue)) || '|' || lower(trim(area))), venue, area, name, created_at
  FROM legacy ON CONFLICT DO NOTHING RETURNING id
)
INSERT INTO wishlist_legacy_imports (user_id, dish_key)
SELECT user_id, dish_key FROM legacy ON CONFLICT DO NOTHING;
