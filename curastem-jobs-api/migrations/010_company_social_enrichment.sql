-- Migration 010: rename Exa columns + add social enrichment gate
-- Run: wrangler d1 execute curastem-jobs --remote --file=migrations/010_company_social_enrichment.sql
-- (Production is also self-healed at Worker boot via ensureCompanyExaColumns in queries.ts.)

-- Rename the category enrichment gate for consistency
ALTER TABLE companies RENAME COLUMN exa_enriched_at TO exa_company_enriched_at;

-- Gate for the Exa deep (type:"deep") social pass.
-- NULL = never run. Set once when the deep call completes — never re-runs automatically.
ALTER TABLE companies ADD COLUMN exa_social_enriched_at INTEGER;
