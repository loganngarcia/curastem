-- Migration 008: website reachability probe metadata
-- Run: wrangler d1 execute curastem-jobs --remote --file=migrations/008_company_website_probe.sql
-- (Production is also self-healed on each cron/admin run via ensureCompanyWebsiteProbeColumns in queries.ts.)
--
-- website_checked_at: last time we probed website_url (epoch seconds)
-- website_infer_suppressed: 1 = do not auto-fill website from {slug}.com (probe failed or dead host)

ALTER TABLE companies ADD COLUMN website_checked_at INTEGER;
ALTER TABLE companies ADD COLUMN website_infer_suppressed INTEGER NOT NULL DEFAULT 0;
