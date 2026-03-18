-- Migration 003: add location_lat, location_lng for distance-based "jobs near you"
-- Run: wrangler d1 execute curastem-jobs --remote --file=migrations/003_add_job_location_coords.sql
-- Jobs are geocoded async; NULL until backfill populates them.

ALTER TABLE jobs ADD COLUMN location_lat REAL;
ALTER TABLE jobs ADD COLUMN location_lng REAL;

CREATE INDEX IF NOT EXISTS idx_jobs_location_coords
  ON jobs (location_lat, location_lng) WHERE location_lat IS NOT NULL AND location_lng IS NOT NULL;
