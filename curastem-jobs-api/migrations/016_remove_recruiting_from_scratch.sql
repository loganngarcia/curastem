-- Drop Recruiting From Scratch (Recruiterflow): source, jobs, aliases, orphaned company row.
-- Matches migrate.ts removedLegacySourceIds + company cleanup (idempotent).

DELETE FROM jobs WHERE source_id = 'rf-recruitingfromscratch';
DELETE FROM sources WHERE id = 'rf-recruitingfromscratch';
DELETE FROM company_aliases WHERE alias_slug = 'recruitingfromscratch' OR canonical_slug = 'recruitingfromscratch';
DELETE FROM companies WHERE slug = 'recruitingfromscratch' AND NOT EXISTS (
  SELECT 1 FROM jobs j WHERE j.company_id = companies.id
);
