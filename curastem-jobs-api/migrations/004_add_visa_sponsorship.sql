-- Migration 004: add visa_sponsorship for AI-extracted sponsorship status.
-- NULL = not mentioned in the posting (most jobs).
-- "yes" = posting explicitly states sponsorship is available.
-- "no"  = posting explicitly states sponsorship is NOT available.

ALTER TABLE jobs ADD COLUMN visa_sponsorship TEXT;
