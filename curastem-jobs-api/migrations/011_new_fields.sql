-- Migration 011: new structured fields for jobs and companies
--
-- jobs: per-job experience minimum, job-site address, and max salary presence
-- companies: exact employee count, HQ lat/lng, aggregated job-location list

-- ── jobs ─────────────────────────────────────────────────────────────────────
ALTER TABLE jobs ADD COLUMN experience_years_min INTEGER;   -- min years required, e.g. 2 for "2+ years"
ALTER TABLE jobs ADD COLUMN job_address TEXT;               -- street address from posting
ALTER TABLE jobs ADD COLUMN job_city TEXT;                  -- city from posting (normalized)
ALTER TABLE jobs ADD COLUMN job_country TEXT;               -- country ISO-2 or name from posting

CREATE INDEX IF NOT EXISTS idx_jobs_experience_years ON jobs (experience_years_min);

-- ── companies ────────────────────────────────────────────────────────────────
ALTER TABLE companies ADD COLUMN employee_count INTEGER;    -- exact headcount from Exa (vs range bucket)
ALTER TABLE companies ADD COLUMN hq_lat REAL;               -- geocoded HQ latitude
ALTER TABLE companies ADD COLUMN hq_lng REAL;               -- geocoded HQ longitude
ALTER TABLE companies ADD COLUMN locations TEXT;            -- JSON array of unique job locations (aggregated from jobs)
