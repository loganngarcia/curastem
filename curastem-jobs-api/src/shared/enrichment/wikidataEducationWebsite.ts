/**
 * Free official-website backfill for education employers (K-12 + higher ed) from Wikidata **P856**
 * (official website). We trust Wikidata’s curated value: only normalize to a valid `http(s)` URL.
 * Reachability is still checked later by `runCompanyWebsiteProbeBatch` on its normal cadence.
 *
 * Flow: `wbsearchentities` (by company name) → `wbgetentities` (batch) → first usable P856 in
 * relevance order (exact label match boosted).
 *
 * Wikidata has no API key; Wikimedia asks for identifyable User-Agent and non-abusive rates.
 * This module caps companies/hour; if you see HTTP 429, lower {@link WIKIDATA_WEBSITE_BATCH}.
 *
 * After a `website_url` is stored, the company is sent to `ENRICHMENT_QUEUE` so `enrichCompanyById`
 * runs Logo.dev → Brandfetch → Gemini like post-ingestion enrichment.
 */

import { listCompaniesForWikidataWebsiteFill, updateCompanyWikidataWebsiteResult } from "../db/queries.ts";
import { logger } from "../utils/logger.ts";
import type { CompanyRow, EnrichmentQueueMessage, Env } from "../types.ts";

const UA =
  "CurastemJobs/1.0 (https://curastem.org; education employer website backfill)";

/** Wikidata JSON API. No API key. */
const WD_API = "https://www.wikidata.org/w/api.php";

/** Companies processed per :30 cron (each needs 1 search + 1 getentities; ~2 subrequests). */
export const WIKIDATA_WEBSITE_BATCH = 20;

type WbSearchHit = { id: string; label?: string; description?: string };

type WbClaim = {
  mainsnak?: { datavalue?: { value?: string } };
};

type WbEntity = {
  claims?: { P856?: WbClaim[] };
};

type WbGetEntities = { entities?: Record<string, WbEntity> };

function normalizeWebsiteCandidate(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  const withScheme = t.startsWith("//") ? `https:${t}` : t;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.href;
  } catch {
    return null;
  }
}

function extractAllP856Raw(entity: WbEntity | undefined): string[] {
  const p856 = entity?.claims?.P856;
  if (!p856 || !Array.isArray(p856)) return [];
  const out: string[] = [];
  for (const claim of p856) {
    const v = claim.mainsnak?.datavalue?.value;
    if (typeof v === "string" && v.trim()) out.push(v.trim());
  }
  return out;
}

function sortSearchHitsByName(hits: WbSearchHit[], companyName: string): WbSearchHit[] {
  const n = companyName.trim().toLowerCase();
  return [...hits].sort((a, b) => {
    const al = (a.label ?? "").toLowerCase();
    const bl = (b.label ?? "").toLowerCase();
    const score = (lab: string) => (lab === n ? 0 : lab.startsWith(n) ? 1 : 2);
    const d = score(al) - score(bl);
    if (d !== 0) return d;
    return 0;
  });
}

async function wikidataSearch(name: string): Promise<WbSearchHit[]> {
  const search = new URLSearchParams({
    action: "wbsearchentities",
    search: name.trim().slice(0, 300),
    language: "en",
    limit: "10",
    format: "json",
  });
  const res = await fetch(`${WD_API}?${search}`, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`wikidata search http ${res.status}`);
  const data = (await res.json()) as { search?: WbSearchHit[] };
  return data.search ?? [];
}

async function wikidataGetEntities(ids: string[]): Promise<Record<string, WbEntity>> {
  if (ids.length === 0) return {};
  const search = new URLSearchParams({
    action: "wbgetentities",
    ids: ids.join("|").slice(0, 5000),
    format: "json",
    props: "claims",
  });
  const res = await fetch(`${WD_API}?${search}`, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`wikidata getentities http ${res.status}`);
  const data = (await res.json()) as WbGetEntities;
  return data.entities ?? {};
}

/**
 * First P856 URL for this name (search relevance + label tie-break) after `http(s)` normalization.
 * Does not HTTP-probe; trust Wikidata. Returns null if no hit or no valid URL.
 */
export async function resolveOfficialWebsiteFromWikidata(companyName: string): Promise<string | null> {
  const rawHits = await wikidataSearch(companyName);
  if (rawHits.length === 0) return null;
  const hits = sortSearchHitsByName(rawHits, companyName);
  const ids = hits.map((h) => h.id);
  const entities = await wikidataGetEntities(ids);
  for (const id of ids) {
    for (const urlRaw of extractAllP856Raw(entities[id])) {
      const normalized = normalizeWebsiteCandidate(urlRaw);
      if (normalized) return normalized;
    }
  }
  return null;
}

async function processOne(
  db: D1Database,
  c: CompanyRow,
  now: number,
  enqueueEnrichment: (companyId: string) => void | Promise<void>
): Promise<void> {
  let url: string | null;
  try {
    url = await resolveOfficialWebsiteFromWikidata(c.name);
  } catch (err) {
    logger.warn("wikidata_website_lookup_failed", {
      company_id: c.id,
      slug: c.slug,
      error: String(err),
    });
    return;
  }
  if (url) {
    await updateCompanyWikidataWebsiteResult(db, c.id, {
      website_url: url,
      wikidata_website_attempted_at: now,
      website_checked_at: null,
    });
    logger.info("wikidata_website_filled", { company_id: c.id, slug: c.slug, url });
    try {
      await enqueueEnrichment(c.id);
    } catch (qErr) {
      logger.warn("wikidata_enrichment_queue_send_failed", { company_id: c.id, error: String(qErr) });
    }
  } else {
    await updateCompanyWikidataWebsiteResult(db, c.id, { wikidata_website_attempted_at: now });
    logger.info("wikidata_website_miss", { company_id: c.id, slug: c.slug, name: c.name });
  }
}

/**
 * Best-effort batch on :30 cron. ~2 Wikidata `fetch` calls per company; no per-URL HTTP checks.
 * Passes `env` so successful website fills can enqueue the same per-company enrichment as ingestion.
 */
export async function runWikidataEducationWebsiteBatch(
  env: Env,
  retryIfAttemptedBeforeEpoch: number
): Promise<void> {
  const db = env.JOBS_DB;
  const now = Math.floor(Date.now() / 1000);
  const companies = await listCompaniesForWikidataWebsiteFill(
    db,
    retryIfAttemptedBeforeEpoch,
    WIKIDATA_WEBSITE_BATCH
  );
  if (companies.length === 0) {
    logger.info("wikidata_website_batch_skipped", { reason: "none_due" });
    return;
  }
  logger.info("wikidata_website_batch_started", { count: companies.length });
  const enqueue = async (companyId: string) => {
    if (env.ENRICHMENT_QUEUE) {
      // Match `ingestion/runner.ts`; `Queue<EnrichmentQueueMessage>` types expect the inner body, not `{ body: … }`.
      await env.ENRICHMENT_QUEUE.send({ body: { companyId } } as unknown as EnrichmentQueueMessage);
    }
  };
  for (const c of companies) {
    try {
      await processOne(db, c, now, enqueue);
    } catch (err) {
      logger.error("wikidata_website_row_failed", { company_id: c.id, error: String(err) });
    }
  }
  logger.info("wikidata_website_batch_done", { count: companies.length });
}
