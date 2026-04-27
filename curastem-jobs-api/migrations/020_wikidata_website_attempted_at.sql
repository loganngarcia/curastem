-- Throttle education Wikidata website (P856) backfill per company; see wikidataEducationWebsite.ts
ALTER TABLE companies ADD COLUMN wikidata_website_attempted_at INTEGER;
