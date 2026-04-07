-- DB deep dive: location_primary denormalization, filter indexes, partial api_keys index.
-- Safe to run multiple times (IF NOT EXISTS / idempotent column add).

ALTER TABLE jobs ADD COLUMN location_primary TEXT;

UPDATE jobs
SET location_primary = json_extract(locations, '$[0]')
WHERE locations IS NOT NULL AND (location_primary IS NULL OR location_primary = '');

CREATE INDEX IF NOT EXISTS idx_jobs_location_primary ON jobs (location_primary);

CREATE INDEX IF NOT EXISTS idx_jobs_job_country ON jobs (job_country, posted_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_salary_min ON jobs (salary_min, posted_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_visa_sponsorship ON jobs (visa_sponsorship, posted_at DESC);

CREATE INDEX IF NOT EXISTS idx_api_keys_active_hash ON api_keys (key_hash) WHERE active = 1;
