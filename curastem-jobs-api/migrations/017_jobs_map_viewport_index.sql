-- GET /jobs/map bbox + recency (see ensureJobIndexes + schema.sql)
CREATE INDEX IF NOT EXISTS idx_jobs_map_viewport
  ON jobs (location_lat, location_lng, company_id, first_seen_at)
  WHERE location_lat IS NOT NULL
    AND location_lng IS NOT NULL
    AND (workplace_type IS NULL OR workplace_type != 'remote');
