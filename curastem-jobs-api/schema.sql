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
  website_infer_suppressed INTEGER NOT NULL DEFAULT 0, -- 1 = never auto-set website from {slug}.com

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
  source_type     TEXT NOT NULL,      -- "greenhouse" | "lever" | "jibe" | "activate_careers" | "oracle_ce" | "brillio" | "phenom" | "paradox" | "jobvite" | "workday" | "smartrecruiters" | "rss" | ...
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
-- No scalar location index on the locations JSON; geocoding uses json_extract(locations, '$[0]')
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

-- ──────────────────────────────────────────────────────────────────────────────
-- company_location_geocodes
-- Persistent cache: (company, city-string) → precise lat/lng + address.
-- Populated by the per-job geocoding path during ingestion.
-- A cache hit avoids a Places API call for every subsequent job at that location.
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
  description           TEXT,                  -- optional note about who / what this key is for
  rate_limit_per_minute INTEGER NOT NULL DEFAULT 60,
  active                INTEGER NOT NULL DEFAULT 1,   -- 0 = revoked
  created_at            INTEGER NOT NULL,
  last_used_at          INTEGER
);

CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys (key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_active ON api_keys (active);
