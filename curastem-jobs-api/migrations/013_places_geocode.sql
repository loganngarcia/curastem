-- Migration 013: track Places API geocode attempts per company
--
-- hq_geocode_failed_at: set when Places API returns no result for this company,
-- preventing repeated retries. Cleared when hq_city or hq_country changes so the
-- company gets another attempt after its location data improves.
ALTER TABLE companies ADD COLUMN hq_geocode_failed_at INTEGER; -- epoch seconds, NULL = never tried or should retry
