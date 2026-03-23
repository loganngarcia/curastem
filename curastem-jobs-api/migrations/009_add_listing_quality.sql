-- Teaser / no-substance postings (e.g. "Apply to learn more") are marked
-- listing_quality = 'placeholder' and excluded from list/search APIs.
-- NULL = not yet assessed; 'ok' = passed AI or default after assessment.

ALTER TABLE jobs ADD COLUMN listing_quality TEXT;
