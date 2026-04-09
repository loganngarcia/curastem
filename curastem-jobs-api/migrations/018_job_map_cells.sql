-- Pre-aggregated geohash cells for GET /jobs/map wide viewport (spread) — see rebuildJobMapCells + listJobsForMapCells.
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
