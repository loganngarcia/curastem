-- Curastem Jobs — D1 Schema
-- Run locally:  wrangler d1 execute curastem-jobs --local --file=schema.sql
-- Run remotely: wrangler d1 execute curastem-jobs --remote --file=schema.sql
--
-- Design notes:
--   • companies and jobs are separate tables so company metadata is never duplicated across rows.
--   • sources drives the ingestion registry; each ATS company/board is one source row.
--   • All timestamps are Unix epoch integers (seconds) for portability and cheap comparisons.
--   • description_raw is never overwritten on update; it holds the original source text for AI reprocessing.
--   • ai_generated_at is nulled whenever description_raw changes so AI fields get regenerated.

-- ──────────────────────────────────────────────────────────────────────────────
-- companies
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS companies (
  id                      TEXT PRIMARY KEY,       -- UUID v4
  name                    TEXT NOT NULL,
  slug                    TEXT NOT NULL UNIQUE,   -- lowercase-hyphenated, used for dedup_key

  -- Optional enrichment fields (nullable; populated by enrichment layer, not ingestion)
  logo_url                TEXT,
  website_url             TEXT,
  website_checked_at      INTEGER,               -- last HTTP probe of website_url (epoch)
  website_infer_suppressed INTEGER NOT NULL DEFAULT 0, -- 1 = do not re-fill company website from Exa after dead URL probe
  wikidata_website_attempted_at INTEGER,          -- last Wikidata P856 website lookup for education companies (epoch)

  -- Social / professional links (Exa primary, Brandfetch fallback)
  linkedin_url            TEXT,
  glassdoor_url           TEXT,
  x_url                   TEXT,
  instagram_url           TEXT,
  youtube_url             TEXT,
  github_url              TEXT,
  huggingface_url         TEXT,
  tiktok_url              TEXT,
  crunchbase_url          TEXT,
  facebook_url            TEXT,

  -- Exa enrichment gate — NULL = never enriched via Exa
  exa_company_enriched_at INTEGER,
  exa_social_enriched_at  INTEGER,

  -- Company profile (all from Exa)
  employee_count_range    TEXT,    -- "1"|"2-10"|"11-50"|"51-200"|"201-500"|"501-1000"|"1001-5000"|"5001-10000"|"10000+"
  employee_count          INTEGER, -- exact headcount when known (Exa; more precise than the range bucket)
  founded_year            INTEGER,
  hq_address              TEXT,    -- full street address, no PO Box
  hq_city                 TEXT,    -- "San Francisco, CA" or "London, UK"
  hq_country              TEXT,    -- ISO 3166-1 alpha-2, e.g. "US"
  hq_lat                  REAL,    -- geocoded latitude of HQ
  hq_lng                  REAL,    -- geocoded longitude of HQ
  hq_geocode_failed_at    INTEGER, -- epoch; set on Places geocode failure, cleared when hq_city/country/address changes
  industry                TEXT,    -- normalized taxonomy: see src/enrichment/exa.ts INDUSTRY_MAP
  company_type            TEXT,    -- "startup"|"enterprise"|"agency"|"nonprofit"|"government"|"university"|"other"
  total_funding_usd       INTEGER, -- total venture capital funding in company lifetime
  locations               TEXT,    -- JSON array of unique job locations aggregated from the jobs table

  -- AI-generated one-sentence company description (lazy, cached)
  description             TEXT,
  description_enriched_at INTEGER,               -- epoch; NULL means not yet generated

  created_at              INTEGER NOT NULL,
  updated_at              INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_companies_slug ON companies (slug);

-- ──────────────────────────────────────────────────────────────────────────────
-- sources
-- One row per ingestion source (e.g. one Greenhouse board, one Lever company).
-- Separating sources from companies allows the same company to appear from
-- multiple ATS boards and lets us track per-source fetch health independently.
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sources (
  id              TEXT PRIMARY KEY,   -- UUID v4
  name            TEXT NOT NULL,      -- human-readable, e.g. "Stripe (Greenhouse)"
  source_type     TEXT NOT NULL,      -- "greenhouse" | "lever" | "jibe" | "edjoin" | "schoolspring" | "k12jobspot" | "higheredjobs" | "chronicle_jobs" | "brassring" | "gusto_recruiting" | "icims_portal" | "lvmh" | "uber" | "shopify" | "hca" | "aramark" | "meta" | "successfactors_rmk" | "symphony_mcloud" | "adp_cx" | "adp_wfn_recruitment" | "activate_careers" | "taleo" | "oracle_ce" | "brillio" | "globallogic" | "phenom" | "paradox" | "jobvite" | "jazzhr" | "workday" | "smartrecruiters" | "consider" | "getro" | "jobright" | "gem" | "rss" | ...
  company_handle  TEXT NOT NULL,      -- ATS-specific company slug / board name
  base_url        TEXT NOT NULL,      -- canonical API or job-board URL for this source
  enabled         INTEGER NOT NULL DEFAULT 1,    -- 0 = disabled, skip in cron

  -- Ingestion health tracking
  last_fetched_at INTEGER,            -- epoch of last successful fetch
  last_job_count  INTEGER,            -- how many jobs returned on last fetch
  last_error      TEXT,               -- last error message if fetch failed

  -- Throttle: minimum hours between fetches (NULL = every cron run, i.e. hourly).
  -- Use for large/slow sources (e.g. full VC portfolio boards) to avoid burning
  -- cron time on sources whose listings change infrequently.
  fetch_interval_hours INTEGER,       -- e.g. 12 = fetch at most twice a day

  created_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sources_type ON sources (source_type);
CREATE INDEX IF NOT EXISTS idx_sources_enabled ON sources (enabled);

-- ──────────────────────────────────────────────────────────────────────────────
-- jobs
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS jobs (
  id              TEXT PRIMARY KEY,   -- deterministic: FNV-1a 64-bit hash of (source_id + ":" + external_id), encoded as 10-char vowels+digits (e.g. "a4u889e47a")

  company_id      TEXT NOT NULL REFERENCES companies (id),
  source_id       TEXT NOT NULL REFERENCES sources (id),
  external_id     TEXT NOT NULL,      -- original ID from the source ATS

  title           TEXT NOT NULL,
  locations       TEXT,               -- JSON array of normalized city strings, e.g. '["San Francisco, CA","New York, NY"]'
                                      -- null = unknown; locations[0] is the primary display value
  -- Denormalized mirror of json_extract(locations,'$[0]') for indexed filters and geocode paths.
  location_primary TEXT,
  employment_type TEXT,               -- "full_time" | "part_time" | "contract" | "internship" | "temporary" | null
  workplace_type  TEXT,               -- "remote" | "hybrid" | "on_site" | null

  apply_url       TEXT NOT NULL,      -- canonical application URL
  source_url      TEXT,               -- job listing URL on the ATS board
  source_name     TEXT NOT NULL,      -- source_type value, denormalized for fast read paths

  -- Raw description is preserved forever; never overwritten once stored.
  -- AI re-processing reads from this column.
  description_raw TEXT,

  -- Salary fields; all nullable, parsed from source when available
  salary_min      INTEGER,
  salary_max      INTEGER,
  salary_currency TEXT,               -- ISO 4217, e.g. "USD"
  salary_period   TEXT,               -- "year" | "month" | "hour" | null

  -- Experience requirement extracted by AI
  experience_years_min INTEGER,       -- minimum years required, e.g. 2 for "2+ years" or "2-3 years"

  -- Geocoded coordinates for the primary job location (locations[0]).
  -- Populated inline at ingestion (Photon/Nominatim) and by the geocode backfill cron.
  -- Whitelisted retail chains (CVS, Dollar Tree, etc.) use Places API for store-level accuracy.
  location_lat    REAL,               -- latitude of locations[0]
  location_lng    REAL,               -- longitude of locations[0]

  -- Per-job physical location (extracted by AI from posting text)
  job_address     TEXT,               -- street address mentioned in the posting
  job_city        TEXT,               -- city mentioned in the posting (normalized)
  job_state       TEXT,               -- US state abbreviation, e.g. "CA", "IN"
  job_country     TEXT,               -- country from the posting (ISO-2 or full name)

  -- Language of the job description text (ISO 639-1).
  -- Populated in two passes: heuristic at ingest/backfill (fast, zero cost),
  -- then AI lazy-load on GET /jobs/:id which overrides and fills remaining nulls.
  -- Supported values: en es de fr pt it nl pl ja zh | null = unknown/ambiguous.
  description_language TEXT,

  -- AI-generated fields (lazy; populated on first GET /jobs/:id request, then cached)
  job_summary        TEXT,            -- two-sentence summary (company + role)
  job_description    TEXT,            -- JSON: {responsibilities, minimum_qualifications, preferred_qualifications}
  visa_sponsorship   TEXT,            -- "yes" | "no" | null (null = not mentioned in posting)
  seniority_level    TEXT,            -- "new_grad"|"entry"|"mid"|"senior"|"staff"|"manager"|"director"|"executive"|null
  ai_generated_at    INTEGER,         -- epoch; NULL = not generated; cleared when description_raw changes

  -- Semantic search embedding (generated at ingestion time via Gemini Embedding API)
  -- The actual vector lives in the Vectorize index (keyed by job id).
  -- This column tracks freshness: NULL = never embedded; cleared when description_raw changes.
  embedding_generated_at INTEGER,     -- epoch; NULL = not yet embedded

  -- Timestamps
  posted_at       INTEGER,            -- source-provided posting time; may be null
  first_seen_at   INTEGER NOT NULL,   -- when Curastem first ingested this job

  -- Cross-source deduplication key: lower(title) + "|" + company_slug
  dedup_key       TEXT NOT NULL,

  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_source_external ON jobs (source_id, external_id);
CREATE INDEX IF NOT EXISTS idx_jobs_company ON jobs (company_id);
CREATE INDEX IF NOT EXISTS idx_jobs_posted_at ON jobs (posted_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_first_seen ON jobs (first_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_dedup_key ON jobs (dedup_key);
CREATE INDEX IF NOT EXISTS idx_jobs_title ON jobs (title);
-- Geocode backfill: find jobs missing coords, ordered newest-first
CREATE INDEX IF NOT EXISTS idx_jobs_location_coords ON jobs (location_lat, first_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_location_primary ON jobs (location_primary);
CREATE INDEX IF NOT EXISTS idx_jobs_employment_type ON jobs (employment_type);
CREATE INDEX IF NOT EXISTS idx_jobs_workplace_type ON jobs (workplace_type);
CREATE INDEX IF NOT EXISTS idx_jobs_seniority_level ON jobs (seniority_level);
CREATE INDEX IF NOT EXISTS idx_jobs_description_language ON jobs (description_language);
CREATE INDEX IF NOT EXISTS idx_jobs_experience_years ON jobs (experience_years_min);

-- Composite index for the embedding backfill query:
--   WHERE embedding_generated_at IS NULL ORDER BY first_seen_at DESC
-- Without this the query requires a full table scan to find un-embedded jobs.
CREATE INDEX IF NOT EXISTS idx_jobs_embedding_backfill
  ON jobs (embedding_generated_at, first_seen_at DESC);

-- Consider description backfill: consider-source rows missing description, newest-first
CREATE INDEX IF NOT EXISTS idx_jobs_consider_backfill
  ON jobs (source_id, first_seen_at DESC) WHERE description_raw IS NULL;

-- Common API filters (listJobs) — composite with recency for selective scans
CREATE INDEX IF NOT EXISTS idx_jobs_job_country
  ON jobs (job_country, posted_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_salary_min
  ON jobs (salary_min, posted_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_visa_sponsorship
  ON jobs (visa_sponsorship, posted_at DESC);

-- GET /jobs/map: bbox + non-remote + recency — partial index keeps working set small
CREATE INDEX IF NOT EXISTS idx_jobs_map_viewport
  ON jobs (location_lat, location_lng, company_id, first_seen_at)
  WHERE location_lat IS NOT NULL
    AND location_lng IS NOT NULL
    AND (workplace_type IS NULL OR workplace_type != 'remote');

-- GET /jobs/map spread viewport: pre-aggregated geohash buckets (rebuilt by cron; see rebuildJobMapCells).
CREATE TABLE IF NOT EXISTS job_map_cells (
  geohash           TEXT    NOT NULL,
  precision         INTEGER NOT NULL,
  etkey             TEXT    NOT NULL DEFAULT '',
  slkey             TEXT    NOT NULL DEFAULT '',
  week_bucket       INTEGER NOT NULL,
  job_count         INTEGER NOT NULL,
  chip_lat          REAL    NOT NULL,
  chip_lng          REAL    NOT NULL,
  company_id        TEXT    NOT NULL,
  company_name      TEXT,
  company_logo_url  TEXT,
  company_slug      TEXT,
  company_hq_lat    REAL,
  company_hq_lng    REAL,
  company_hq_city   TEXT,
  company_hq_country TEXT,
  company_hq_address TEXT,
  PRIMARY KEY (geohash, precision, etkey, slkey, week_bucket)
);

CREATE INDEX IF NOT EXISTS idx_job_map_cells_lookup
  ON job_map_cells (precision, etkey, slkey, week_bucket);

-- ──────────────────────────────────────────────────────────────────────────────
-- company_location_geocodes
-- Persistent cache: (company, city-string) → precise lat/lng + address.
-- Populated by the per-job geocoding path during ingestion.
-- Same location_key may be copied from another company’s row only after Mapbox/Places miss (city fallback).
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS company_location_geocodes (
  company_id   TEXT    NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  location_key TEXT    NOT NULL,  -- normalized location string, e.g. "Houston, TX"
  lat          REAL    NOT NULL,
  lng          REAL    NOT NULL,
  address      TEXT,              -- formatted address returned by Places API
  geocoded_at  INTEGER NOT NULL,  -- epoch seconds
  PRIMARY KEY (company_id, location_key)
);

-- ──────────────────────────────────────────────────────────────────────────────
-- company_aliases
-- Maps variant company name slugs → canonical company slug.
-- Populated by migrate.ts seed data; used at ingestion time so that
-- "hadrian" (from Consider) and "hadrian-automation" (from Ashby) resolve to
-- the same company row and share a dedup_key namespace.
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS company_aliases (
  alias_slug      TEXT PRIMARY KEY,   -- variant slug, e.g. "hadrian"
  canonical_slug  TEXT NOT NULL       -- slug of the authoritative companies row
);

CREATE INDEX IF NOT EXISTS idx_company_aliases_canonical ON company_aliases (canonical_slug);

-- ──────────────────────────────────────────────────────────────────────────────
-- api_keys
-- Keys are never stored plaintext; only the SHA-256 hex digest is stored.
-- Issuance is manual (developers@curastem.org); no self-serve dashboard yet.
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS api_keys (
  id                    TEXT PRIMARY KEY,   -- UUID v4
  key_hash              TEXT NOT NULL UNIQUE,  -- SHA-256 hex of the raw bearer token
  owner_email           TEXT NOT NULL,
  account_id            TEXT REFERENCES developer_accounts(id),
  name                  TEXT,
  key_prefix            TEXT,
  scopes                TEXT,                  -- JSON array of allowed scopes; null = legacy/all
  daily_limit_usd_micros INTEGER,
  monthly_limit_usd_micros INTEGER,
  description           TEXT,                  -- optional note about who / what this key is for
  rate_limit_per_minute INTEGER NOT NULL DEFAULT 60,
  active                INTEGER NOT NULL DEFAULT 1,   -- 0 = revoked
  created_at            INTEGER NOT NULL,
  last_used_at          INTEGER
);

CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys (key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_active ON api_keys (active);
-- Auth path: WHERE key_hash = ? AND active = 1 — smaller partial index
CREATE INDEX IF NOT EXISTS idx_api_keys_active_hash ON api_keys (key_hash) WHERE active = 1;

-- ──────────────────────────────────────────────────────────────────────────────
-- PUBLIC DEVELOPER PLATFORM
-- Dollar-denominated usage billing. Balances and charges are stored as integer
-- micro-USD (1 USD = 1,000,000) to avoid floating point accounting drift.
-- Raw provider cost is multiplied by charge_multiplier (default 5x) and deducted
-- from the developer account balance. API keys are still stored hashed only.
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS developer_accounts (
  id                      TEXT PRIMARY KEY,
  name                    TEXT NOT NULL,
  owner_email             TEXT NOT NULL,
  status                  TEXT NOT NULL DEFAULT 'active', -- active|suspended
  created_at              INTEGER NOT NULL,
  updated_at              INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_developer_accounts_owner_email
  ON developer_accounts (owner_email);

CREATE TABLE IF NOT EXISTS developer_account_balances (
  account_id              TEXT PRIMARY KEY REFERENCES developer_accounts(id) ON DELETE CASCADE,
  balance_usd_micros      INTEGER NOT NULL DEFAULT 0,
  updated_at              INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS developer_balance_transactions (
  id                      TEXT PRIMARY KEY,
  account_id              TEXT NOT NULL REFERENCES developer_accounts(id) ON DELETE CASCADE,
  type                    TEXT NOT NULL, -- top_up|adjustment|usage_debit|refund
  amount_usd_micros       INTEGER NOT NULL,
  balance_after_usd_micros INTEGER NOT NULL,
  description             TEXT,
  admin_actor             TEXT,
  created_at              INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_developer_balance_transactions_account
  ON developer_balance_transactions (account_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public_usage_ledger (
  id                      TEXT PRIMARY KEY,
  account_id              TEXT NOT NULL REFERENCES developer_accounts(id) ON DELETE CASCADE,
  api_key_id              TEXT NOT NULL REFERENCES api_keys(id),
  request_id              TEXT NOT NULL,
  route                   TEXT NOT NULL,
  tool_name               TEXT,
  status                  TEXT NOT NULL, -- succeeded|failed|rejected
  provider                TEXT,
  model                   TEXT,
  input_tokens            INTEGER NOT NULL DEFAULT 0,
  output_tokens           INTEGER NOT NULL DEFAULT 0,
  total_tokens            INTEGER NOT NULL DEFAULT 0,
  raw_cost_usd_micros     INTEGER NOT NULL DEFAULT 0,
  charge_multiplier       REAL NOT NULL DEFAULT 5,
  charged_usd_micros      INTEGER NOT NULL DEFAULT 0,
  balance_after_usd_micros INTEGER,
  metadata_json           TEXT,
  created_at              INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_public_usage_ledger_request
  ON public_usage_ledger (request_id);
CREATE INDEX IF NOT EXISTS idx_public_usage_ledger_account
  ON public_usage_ledger (account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_public_usage_ledger_key
  ON public_usage_ledger (api_key_id, created_at DESC);

-- ──────────────────────────────────────────────────────────────────────────────
-- USER ACCOUNTS (auth + cross-device sync)
-- ──────────────────────────────────────────────────────────────────────────────
-- Firebase verifies identity (Google/email); these tables own all user data.
-- users.id is our own UUID so the rows survive any future auth-provider swap.
-- google_sub is the portable identifier across providers (Firebase, Auth0, Clerk, ...).
-- All user-scoped FK columns reference users(id) with ON DELETE CASCADE so
-- `DELETE /auth/me` removes every trace (see routes/auth.ts).
-- ──────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
  id                   TEXT PRIMARY KEY,          -- UUID v4 we generate on first sign-in
  email                TEXT NOT NULL UNIQUE,
  google_sub           TEXT NOT NULL UNIQUE,      -- stable across auth providers
  firebase_uid         TEXT UNIQUE,               -- secondary; provider-specific
  display_name         TEXT,
  photo_url            TEXT,
  created_at           INTEGER NOT NULL,
  last_login_at        INTEGER NOT NULL,
  scheduled_delete_at  INTEGER,                   -- Unix seconds; null = active account
  email_job_alerts     INTEGER NOT NULL DEFAULT 1,
  email_local_events   INTEGER NOT NULL DEFAULT 1,
  email_announcements  INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_users_google_sub ON users (google_sub);
CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);

-- 1:1 with users. Mirrors the localStorage profile keys used in web.tsx
-- (you_name/school/work/interests, dismissed_interest_chips, resume fields).
CREATE TABLE IF NOT EXISTS profile (
  user_id                   TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  you_name                  TEXT,
  you_school                TEXT,
  you_work                  TEXT,
  you_interests             TEXT,        -- newline-separated bullets (matches localStorage format)
  dismissed_interest_chips  TEXT,        -- JSON array
  resume_plain              TEXT,        -- curastem_resume (plain text from save_resume tool)
  resume_doc_html           TEXT,        -- curastem_resume_doc_html (structured DocEditor HTML)
  resume_file_r2_key        TEXT,        -- R2 object key for the original upload
  resume_file_name          TEXT,
  resume_file_mime          TEXT,
  resume_file_size          INTEGER,
  updated_at                INTEGER NOT NULL
);

-- Chats (v2) — metadata only; messages live in chat_messages.
--
-- Design:
--   • updated_at is a second-granularity epoch and moves on ANY change:
--     new message arrival (sidebar recency), title edit, pin/unpin, ref update.
--   • last_message_at / last_message_preview are denormalized for the sidebar
--     so listing N chats is a single SELECT with no per-chat join.
--   • meta_hash is sha256 of canonical { title, is_pinned, pinned_at, meta_json }
--     — NOT the messages. Messages dedup separately via chat_messages.content_hash.
--     This keeps meta_hash stable while messages stream.
--   • meta_json holds the non-message payload: { suggestions, notes, docType,
--     docCompany, activeDocId, refs: { docs, app, whiteboard } }.
CREATE TABLE IF NOT EXISTS chats (
  id                    TEXT PRIMARY KEY,   -- client-generated UUID (stable across sync)
  user_id               TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title                 TEXT,
  is_pinned             INTEGER NOT NULL DEFAULT 0,
  pinned_at             INTEGER,
  created_at            INTEGER NOT NULL,
  updated_at            INTEGER NOT NULL,
  last_message_at       INTEGER,            -- millis; NULL for empty chats
  last_message_preview  TEXT,               -- first ~160 chars of newest message text
  message_count         INTEGER NOT NULL DEFAULT 0,
  next_seq              INTEGER NOT NULL DEFAULT 1, -- next monotonic seq for chat_messages
  meta_json             TEXT NOT NULL,      -- see above
  meta_hash             TEXT NOT NULL,      -- sha256 of canonical meta + title/pin
  payload_json          TEXT NOT NULL DEFAULT '{}', -- legacy alias for older deployed D1 tables
  content_hash          TEXT NOT NULL DEFAULT '' -- legacy alias for older deployed D1 tables
);
CREATE INDEX IF NOT EXISTS idx_chats_user_updated ON chats (user_id, updated_at DESC, id);
CREATE INDEX IF NOT EXISTS idx_chats_user_pinned_updated ON chats (user_id, is_pinned DESC, pinned_at DESC, updated_at DESC, id);
CREATE INDEX IF NOT EXISTS idx_chats_user_hash ON chats (user_id, meta_hash);

-- chat_messages — one row per message. (chat_id, seq) is the stable PK;
-- created_at is in MILLIS to disambiguate messages in the same second.
-- Scroll-up pagination uses (created_at DESC, seq DESC) as the cursor tuple.
CREATE TABLE IF NOT EXISTS chat_messages (
  chat_id        TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  seq            INTEGER NOT NULL,          -- per-chat monotonic counter (starts at 1)
  created_at     INTEGER NOT NULL,          -- epoch MILLIS
  role           TEXT NOT NULL,             -- 'user'|'assistant'|'system'|'tool'|'status'|...
  content_json   TEXT NOT NULL,             -- opaque to server; full web.tsx Message object
  content_hash   TEXT NOT NULL,             -- sha256 of canonical content_json (dedup key)
  PRIMARY KEY (chat_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_chat_recency
  ON chat_messages (chat_id, created_at DESC, seq DESC);
CREATE INDEX IF NOT EXISTS idx_chat_messages_user_recency
  ON chat_messages (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_messages_content_hash
  ON chat_messages (chat_id, content_hash);

-- tombstones — record of deletes so sync doesn't resurrect locally-deleted rows.
-- entity_id for 'message' kind is encoded as "<chat_id>:<seq>".
CREATE TABLE IF NOT EXISTS tombstones (
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,                -- 'chat' | 'doc' | 'app' | 'message'
  entity_id   TEXT NOT NULL,
  deleted_at  INTEGER NOT NULL,             -- epoch MILLIS
  PRIMARY KEY (user_id, kind, entity_id)
);
CREATE INDEX IF NOT EXISTS idx_tombstones_user_deleted ON tombstones (user_id, deleted_at DESC);

-- Docs — one row per ChatDocEntry (kind = "doc" | "resume" | "cover_letter").
CREATE TABLE IF NOT EXISTS docs (
  id            TEXT PRIMARY KEY,            -- matches ChatDocEntry.id
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chat_id       TEXT REFERENCES chats(id) ON DELETE SET NULL,
  kind          TEXT NOT NULL,               -- 'doc' | 'resume' | 'cover_letter'
  title         TEXT,
  doc_company   TEXT,
  html          TEXT NOT NULL,
  content_hash  TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_docs_user_updated ON docs (user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_docs_chat ON docs (chat_id);

-- Apps — mini-apps (ChatSession.app) and whiteboards (ChatSession.whiteboard).
-- Discriminator 'kind' controls payload_json shape.
CREATE TABLE IF NOT EXISTS apps (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chat_id       TEXT REFERENCES chats(id) ON DELETE SET NULL,
  kind          TEXT NOT NULL,               -- 'app' | 'whiteboard'
  title         TEXT,
  payload_json  TEXT NOT NULL,               -- { code, mode } for app; whiteboard JSON for whiteboard
  content_hash  TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_apps_user_updated ON apps (user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_apps_chat ON apps (chat_id);

-- Sessions — backs the curastem_session cookie (and Bearer fallback).
-- Opaque 32-byte token; only the sha256 is stored so a DB leak can't forge sessions.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash    TEXT PRIMARY KEY,            -- sha256 hex of opaque token
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at    INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL,
  user_agent    TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions (expires_at);

-- ──────────────────────────────────────────────────────────────────────────────
-- Schema change discipline (read before adding columns)
-- New job/company columns: update this file, src/shared/types.ts *Row interfaces,
-- and ensure*Columns in src/shared/db/queries.ts in the same PR so cold D1 and docs stay aligned.
-- ──────────────────────────────────────────────────────────────────────────────
