/**
 * Thanks for using Curastem! Curastem is a 501(c)(3) non-profit dedicated to connecting
 * high-quality talent with job opportunities. Our mission is to serve underserved job
 * applicants and support local communities. Consider joining us on this mission. Questions?
 * Contact developers@curastem.org
 *
 * Netflix Careers — Eightfold-based fetcher using sitemap + position_details API.
 *
 * Netflix uses a custom Eightfold deployment at explore.jobs.netflix.net. Their
 * PCS search API is auth-gated ("PCSX is not enabled for this user"), but the
 * sitemap and per-job position_details API are publicly accessible:
 *
 *   Sitemap:  https://apply.netflixhouse.com/careers/sitemap.xml?domain=netflix.com&microsite=netflix.com
 *   Details:  GET {origin}/api/pcsx/position_details?position_id={id}&domain={domain}&hl=en
 *
 * `base_url` must be the careers page with a `domain` param, e.g.
 *   https://explore.jobs.netflix.net/careers?domain=netflix.com
 */

import type { JobSource, NormalizedJob, SourceRow } from "../../types.ts";
import {
  normalizeLocation,
  normalizeWorkplaceType,
  parseEpochSeconds,
} from "../../utils/normalize.ts";

const USER_AGENT = "Curastem-Jobs-Ingestion/1.0 (developers@curastem.org)";
// Lower concurrency avoids triggering Eightfold's per-IP rate limit on the position_details endpoint.
const DETAIL_CONCURRENCY = 6;

interface EightfoldPositionDetail {
  id: number;
  name: string;
  locations?: string[];
  standardizedLocations?: string[];
  postedTs?: number;
  jobDescription?: string | null;
  workLocationOption?: string | null;
  locationFlexibility?: string | null;
  department?: string | null;
  positionUrl?: string | null;
  publicUrl?: string | null;
}

function parseBase(baseUrl: string): { origin: string; domain: string } {
  const u = new URL(baseUrl.trim());
  const domain = u.searchParams.get("domain");
  if (!domain) {
    throw new Error(`netflix: base_url must include ?domain= param, got ${baseUrl}`);
  }
  return { origin: u.origin, domain };
}

async function fetchSitemapIds(origin: string, domain: string): Promise<number[]> {
  // sitemap is served from apply.netflixhouse.com — derive from origin pattern
  const sitemapHost = origin.replace(/^https?:\/\/[^/]+/, "https://apply.netflixhouse.com");
  const url = `${sitemapHost}/careers/sitemap.xml?domain=${domain}&microsite=${domain}`;
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/xml,text/xml" },
  });
  if (!res.ok) {
    throw new Error(`netflix: sitemap ${res.status} from ${url}`);
  }
  const xml = await res.text();
  const ids: number[] = [];
  // URLs are: /careers/job/{id}-{slug}
  const re = /\/careers\/job\/(\d+)-/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    ids.push(Number(m[1]));
  }
  return [...new Set(ids)]; // dedupe
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchPositionDetail(
  origin: string,
  domain: string,
  positionId: number
): Promise<EightfoldPositionDetail | null> {
  const q = new URLSearchParams({ position_id: String(positionId), domain, hl: "en" });
  const url = `${origin}/api/pcsx/position_details?${q}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json",
        Referer: `${origin}/careers`,
      },
    });
    if (res.status === 429 || res.status === 503) {
      await sleep(2000);
      continue;
    }
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: EightfoldPositionDetail };
    return json.data ?? null;
  }
  return null;
}

async function parallelMap<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

export const netflixFetcher: JobSource = {
  sourceType: "netflix",

  async fetch(source: SourceRow): Promise<NormalizedJob[]> {
    const { origin, domain } = parseBase(source.base_url);

    const positionIds = await fetchSitemapIds(origin, domain);
    if (positionIds.length === 0) {
      throw new Error(`netflix: 0 position IDs from sitemap for domain=${domain}`);
    }

    const details = await parallelMap(positionIds, DETAIL_CONCURRENCY, (id) =>
      fetchPositionDetail(origin, domain, id).catch(() => null)
    );

    const jobs: NormalizedJob[] = [];
    for (let i = 0; i < positionIds.length; i++) {
      const detail = details[i];
      if (!detail || !detail.name?.trim()) continue;

      const title = detail.name.trim();
      const locRaw = detail.standardizedLocations?.[0] ?? detail.locations?.[0] ?? null;
      const location = normalizeLocation(locRaw);
      const workplace = normalizeWorkplaceType(
        detail.workLocationOption ?? detail.locationFlexibility ?? null,
        locRaw
      );

      const applyUrl = detail.publicUrl?.trim() || `${origin}/careers/job/${detail.id}`;
      const source_url = applyUrl;

      jobs.push({
        external_id: String(detail.id),
        title,
        location,
        employment_type: null,
        workplace_type: workplace,
        apply_url: applyUrl,
        source_url,
        description_raw: detail.jobDescription?.trim() || null,
        salary_min: null,
        salary_max: null,
        salary_currency: null,
        salary_period: null,
        posted_at: detail.postedTs != null ? parseEpochSeconds(detail.postedTs) : null,
        company_name: "Netflix",
        company_logo_url: null,
        company_website_url: null,
      });
    }

    if (jobs.length === 0) {
      throw new Error(`netflix: ${positionIds.length} IDs fetched but 0 jobs normalized`);
    }
    return jobs;
  },
};
