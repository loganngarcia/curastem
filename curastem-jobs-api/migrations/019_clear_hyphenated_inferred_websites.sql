-- Drop legacy company website_url values that contain a hyphen. These were almost
-- always the removed slug-inference pattern `https://{slugified-name}.com` (K–12, etc).
-- We no longer auto-fill from slug; Exa/ingestion may repopulate real URLs.
-- Clears website_checked_at so a future HTTP probe re-runs when a real URL is set.
UPDATE companies
SET website_url = NULL,
    website_checked_at = NULL
WHERE website_url IS NOT NULL
  AND INSTR(website_url, '-') > 0;
