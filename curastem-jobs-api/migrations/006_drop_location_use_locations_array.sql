-- Migration 006: drop the `location` scalar column; `locations` JSON array is now the sole
-- normalized display field. `location_raw` remains for geocoding and source preservation.
--
-- Geocoding (location_lat / location_lng) now keys off json_extract(locations, '$[0]')
-- so coords are derived from the primary entry of the normalized array.
--
-- Before dropping, backfill `locations` for all rows that have a normalized `location`
-- but no `locations` array yet (i.e. the AI hasn't processed them yet).
--
-- Run: wrangler d1 execute curastem-jobs --remote --file=migrations/006_drop_location_use_locations_array.sql

-- Backfill locations from existing location where locations is still null
UPDATE jobs
SET locations = json_array(location)
WHERE location IS NOT NULL AND location != '' AND locations IS NULL;

-- Drop the index that references the location column (required before column drop)
DROP INDEX IF EXISTS idx_jobs_location;

-- Drop the now-redundant scalar column
ALTER TABLE jobs DROP COLUMN location;
