-- Migration 005: add location_raw and locations columns
--
-- location_raw: the original, unmodified string from the ATS source
-- locations:    JSON array of normalized city strings extracted by AI
--               e.g. ["San Francisco, CA", "New York, NY"]
--
-- The existing `location` column stays as the canonical normalized display value.
-- At ingest time, sources now write both location (normalized) and location_raw (raw).
-- On lazy AI load, `locations` is populated and `location` may be overridden with the
-- AI's best canonical city (unless it already matches exactly).
--
-- Run: wrangler d1 execute curastem-jobs --remote --file=migrations/005_add_location_raw_and_locations.sql

ALTER TABLE jobs ADD COLUMN location_raw TEXT;
ALTER TABLE jobs ADD COLUMN locations     TEXT;   -- JSON array, e.g. '["San Francisco, CA","New York, NY"]'

-- Backfill location_raw from location for all existing rows so history is preserved
UPDATE jobs SET location_raw = location WHERE location_raw IS NULL;
