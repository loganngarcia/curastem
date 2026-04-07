-- Partial index for Consider description backfill query (source_type='consider',
-- description_raw IS NULL, newest-first). Replaces per-row correlated NOT EXISTS scan.
CREATE INDEX IF NOT EXISTS idx_jobs_consider_backfill
  ON jobs (source_id, first_seen_at DESC) WHERE description_raw IS NULL;
