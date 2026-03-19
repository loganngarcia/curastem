-- Migration 007: drop location_raw — locations (JSON array) is now the sole location field.
-- Normalization at ingest + AI lazy-load both write directly to locations.
--
-- Run: wrangler d1 execute curastem-jobs --remote --file=migrations/007_drop_location_raw.sql

ALTER TABLE jobs DROP COLUMN location_raw;
