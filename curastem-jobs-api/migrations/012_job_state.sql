-- Migration 012: add job_state for US state abbreviation
-- Separates "IN" (state) from "US" (country) so city+state works for US
-- and city+country works for international.
ALTER TABLE jobs ADD COLUMN job_state TEXT; -- US state abbreviation, e.g. "IN", "CA"
