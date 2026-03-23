/**
 * Periodic HTTP checks on stored company websites.
 *
 * Clears dead URLs from the DB and sets website_infer_suppressed so enrichment
 * does not immediately re-insert https://{slug}.com (often wrong or also dead).
 *
 * Conservative: bot walls (401/403/429) count as reachable; 5xx and timeouts
 * only defer re-check without clearing.
 */

import {
  listCompaniesForWebsiteProbe,
  updateCompanyWebsiteProbeResult,
} from "../db/queries.ts";
import { logger } from "../utils/logger.ts";

const PROBE_BATCH = 6;
const MIN_SECONDS_BETWEEN_PROBES = 14 * 24 * 60 * 60;
const FETCH_TIMEOUT_MS = 12_000;

// AbortSignal.timeout is not available in all Workers compatibility dates.
// Fall back to a manual AbortController + setTimeout so the probe never hangs.
function makeTimeoutSignal(ms: number): AbortSignal {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  // Prevent the timer from keeping the event loop alive if the fetch resolves first
  controller.signal.addEventListener("abort", () => clearTimeout(timer), { once: true });
  return controller.signal;
}

type ProbeOutcome = "ok" | "dead" | "defer";

function classifyProbeResponse(status: number): ProbeOutcome {
  if (status >= 200 && status < 400) return "ok";
  if (status === 401 || status === 403 || status === 429) return "ok";
  if (status === 404 || status === 410) return "dead";
  if (status >= 500) return "defer";
  if (status >= 400) return "dead";
  return "defer";
}

async function probeWebsiteUrl(url: string): Promise<ProbeOutcome> {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return "dead";
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "dead";

  try {
    const res = await fetch(parsed.href, {
      method: "GET",
      redirect: "follow",
      signal: makeTimeoutSignal(FETCH_TIMEOUT_MS),
      headers: {
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
        "User-Agent":
          "Mozilla/5.0 (compatible; CurastemJobs/1.0; +https://curastem.org) jobs-indexing",
      },
    });
    return classifyProbeResponse(res.status);
  } catch {
    return "defer";
  }
}

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
      const outcome = await probeWebsiteUrl(c.website_url);
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
