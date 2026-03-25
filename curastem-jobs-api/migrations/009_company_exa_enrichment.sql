-- Migration 009: Exa enrichment fields + extended company profile
-- Run: wrangler d1 execute curastem-jobs --remote --file=migrations/009_company_exa_enrichment.sql
-- (Production is also self-healed on each cron/admin run via ensureCompanyExaColumns in queries.ts.)

-- Exa enrichment gate — NULL = never enriched; set to epoch when Exa call completes
ALTER TABLE companies ADD COLUMN exa_enriched_at INTEGER;

-- Additional social / developer links
ALTER TABLE companies ADD COLUMN instagram_url    TEXT;
ALTER TABLE companies ADD COLUMN youtube_url      TEXT;
ALTER TABLE companies ADD COLUMN github_url       TEXT;
ALTER TABLE companies ADD COLUMN huggingface_url  TEXT;
ALTER TABLE companies ADD COLUMN tiktok_url       TEXT;
ALTER TABLE companies ADD COLUMN crunchbase_url   TEXT;
ALTER TABLE companies ADD COLUMN facebook_url     TEXT;

-- Company profile fields
-- employee_count_range: "1" | "2-10" | "11-50" | "51-200" | "201-500" | "501-1000" | "1001-5000" | "5001-10000" | "10000+"
ALTER TABLE companies ADD COLUMN employee_count_range TEXT;
ALTER TABLE companies ADD COLUMN founded_year         INTEGER;
ALTER TABLE companies ADD COLUMN hq_address           TEXT;  -- full street address, no PO Box
ALTER TABLE companies ADD COLUMN hq_city              TEXT;  -- "San Francisco, CA" or "London, UK"
ALTER TABLE companies ADD COLUMN hq_country           TEXT;  -- ISO 3166-1 alpha-2, e.g. "US", "DE"
-- industry: normalized taxonomy value (see src/enrichment/exa.ts INDUSTRY_MAP)
ALTER TABLE companies ADD COLUMN industry             TEXT;
-- company_type: "startup" | "enterprise" | "agency" | "nonprofit" | "government" | "university" | "other"
ALTER TABLE companies ADD COLUMN company_type         TEXT;
ALTER TABLE companies ADD COLUMN total_funding_usd    INTEGER;
