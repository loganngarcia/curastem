/**
 * Periodic HTTP checks on stored company websites.
 *
 * Clears dead URLs from the DB and sets website_infer_suppressed so Exa does not
 * immediately re-fill a bad website_url after the probe.
 *
 * Conservative: bot walls (401/403/429) count as reachable; 5xx and timeouts
 * only defer re-check without clearing.
 */

import {
  listCompaniesForWebsiteProbe,
  updateCompanyWebsiteProbeResult,
} from "../db/queries.ts";
import { logger } from "../utils/logger.ts";
import { probeHttpUrlReachability, type WebsiteReachability } from "../utils/websiteReachability.ts";

const PROBE_BATCH = 6;
const MIN_SECONDS_BETWEEN_PROBES = 14 * 24 * 60 * 60;

/**
 * Best-effort batch run after ingestion. Bounded size to limit outbound fetches per cron.
 */
export async function runCompanyWebsiteProbeBatch(db: D1Database): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const recheckIfOlderThan = now - MIN_SECONDS_BETWEEN_PROBES;
  const companies = await listCompaniesForWebsiteProbe(db, recheckIfOlderThan, PROBE_BATCH);
  if (companies.length === 0) {
    logger.info("website_probe_skipped", { reason: "none_due" });
    return;
  }

  logger.info("website_probe_started", { count: companies.length });

  let ok = 0, dead = 0, deferred = 0;
  for (const c of companies) {
    if (!c.website_url?.trim()) continue;
    try {
      const outcome: WebsiteReachability = await probeHttpUrlReachability(c.website_url, {
        method: "GET",
      });
      const suppressed = c.website_infer_suppressed ?? 0;

      if (outcome === "ok") {
        await updateCompanyWebsiteProbeResult(db, c.id, {
          website_checked_at: now,
          website_infer_suppressed: 0,
          website_url: c.website_url,
        });
        logger.info("website_probe_ok", { company_id: c.id, slug: c.slug });
        ok++;
      } else if (outcome === "dead") {
        await updateCompanyWebsiteProbeResult(db, c.id, {
          website_checked_at: now,
          website_infer_suppressed: 1,
          website_url: null,
        });
        logger.warn("website_probe_dead", { company_id: c.id, slug: c.slug, url: c.website_url });
        dead++;
      } else {
        await updateCompanyWebsiteProbeResult(db, c.id, {
          website_checked_at: now,
          website_infer_suppressed: suppressed,
          website_url: c.website_url,
        });
        logger.info("website_probe_deferred", { company_id: c.id, slug: c.slug });
        deferred++;
      }
    } catch (err) {
      // Log and continue — one bad D1 write must not abort the rest of the batch
      logger.error("website_probe_update_failed", { company_id: c.id, slug: c.slug, error: String(err) });
    }
  }

  logger.info("website_probe_completed", { ok, dead, deferred });
}
