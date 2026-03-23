-- Internal column: not part of the public REST job object. Values gate list/search
-- and map to HTTP 410 JOB_UNAVAILABLE on GET /jobs/:id when not syndicated.

ALTER TABLE jobs ADD COLUMN listing_quality TEXT;
