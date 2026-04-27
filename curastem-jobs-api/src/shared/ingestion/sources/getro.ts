/**
 * Getro-powered VC job boards (Next.js, shared `cdn.getro.com` assets).
 *
 * Discovery:
 *   GET {origin}/sitemap.xml → if sitemapindex, fetch all sitemap_jobs*.xml shards in parallel;
 *   otherwise parse the flat urlset. Collect <loc> URLs matching /companies/{s}/jobs/{j}.
 *
 * Detail + description:
 *   GET {origin}/_next/data/{buildId}/companies/.../jobs/....json
 *   pageProps.initialState.jobs.currentJob includes full HTML description, apply url,
 *   compensation, organization, and locations.
 *
 *   buildId is a routing key in Getro's nginx (not a Vercel deploy hash). It changes on
 *   Getro deploys but is shared across all boards. When a stale buildId causes every
 *   detail fetch to 404, the fetcher throws rather than silently advancing the cursor.
 *
 * workMode note:
 *   workMode is absent from the currentJob detail response (always null). Remote/hybrid
 *   jobs include "Remote" or "Hybrid" as named locations, so normalizeWorkplaceType
 *   catches them via the location string fallback.
 *
 * Batching:
 *   RATE_LIMIT_KV key `getro_cursor:{source_id}` stores { offset, sig }. Each cron
 *   processes up to GETRO_JOBS_PER_RUN URLs then advances. sig resets the cursor when
 *   the sitemap set changes. Without KV every run starts from offset 0.
 *
 * User-Agent:
 *   Getro blocks non-browser UAs on some sitemap endpoints with a plain-text wall;
 *   use a realistic Chrome desktop UA for all requests.
 */

import type {
  Env,
  JobSource,
  NormalizedJob,
  SalaryPeriod,
  SourceRow,
  WorkplaceType,
} from "../../types.ts";
import {
  normalizeEmploymentType,
  normalizeLocation,
  normalizeWorkplaceType,
  parseEpochSeconds,
} from "../../utils/normalize.ts";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const HEADERS: Record<string, string> = {
  "User-Agent": USER_AGENT,
  Accept: "text/html,application/json,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

/**
 * Jobs to fetch per cron (detail JSON calls = subrequests).
 *
 * Workers Paid hard cap: 1,000 subrequests per invocation.
 * With up to 5 Getro boards running per cron + Consider boards + backfill
 * HTTP calls, budget per board ≈ 100.  The KV cursor advances each run so
 * the full corpus is ingested incrementally over multiple cron cycles.
 */
const GETRO_JOBS_PER_RUN = 100;

/** Parallel detail fetches per batch wave. */
const GETRO_CONCURRENCY = 12;

/**
 * If this fraction of the batch returns null, assume a stale buildId and throw
 * rather than advancing the cursor and permanently skipping jobs.
 */
const STALE_BUILD_NULL_THRESHOLD = 0.9;

const KV_CURSOR_PREFIX = "getro_cursor:";

// ─── Getro API types ──────────────────────────────────────────────────────────

interface GetroOrg {
  id?: number;
  name?: string;
  domain?: string;
  logoUrl?: string;
}

interface GetroLocation {
  name?: string;
}

interface GetroCurrentJob {
  id?: number | null;
  title?: string | null;
  description?: string | null;
  url?: string | null;
  postedAt?: string | null;
  /** Always null in the detail endpoint; workMode lives in the list API only.
   *  Remote jobs instead have "Remote" as a named location. */
  workMode?: string | null;
  locations?: GetroLocation[];
  compensationAmountMinCents?: number | null;
  compensationAmountMaxCents?: number | null;
  compensationCurrency?: string | null;
  compensationPeriod?: string | null;
  /** false = employer has hidden salary; we respect this and store null. */
  compensationPublic?: boolean | null;
  status?: string | null;
  employmentTypes?: string[];
  organization?: GetroOrg;
}

interface GetroPageJson {
  pageProps?: {
    initialState?: {
      jobs?: {
        currentJob?: GetroCurrentJob;
      };
    };
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extractLocs(xml: string): string[] {
  const out: string[] = [];
  const re = /<loc>([^<]+)<\/loc>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    out.push(m[1].trim());
  }
  return out;
}

/** Returns the `/companies/.../jobs/...` path segment, or null for non-job URLs. */
function jobPathFromJobUrl(fullUrl: string): string | null {
  try {
    const u = new URL(fullUrl);
    const match = u.pathname.match(/^(\/companies\/[^/]+\/jobs\/[^/]+)\/?$/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/**
 * Cheap fingerprint for the current sitemap set.
 * A change in count or boundary URLs resets the cursor.
 */
function listSig(sortedUrls: string[]): string {
  if (sortedUrls.length === 0) return "0";
  return `${sortedUrls.length}:${sortedUrls[0]}:${sortedUrls[sortedUrls.length - 1]}`;
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`getro: GET ${url} → HTTP ${res.status}`);
  return res.text();
}

/**
 * Discover all job URLs from the sitemap.
 * Sitemapindex shards are fetched in parallel; the flat urlset is parsed directly.
 */
async function discoverJobUrls(origin: string): Promise<string[]> {
  const indexXml = await fetchText(`${origin}/sitemap.xml`);
  const set = new Set<string>();

  if (indexXml.includes("<sitemapindex")) {
    const childLocs = extractLocs(indexXml);
    let jobSitemaps = childLocs.filter((loc) => loc.toLowerCase().includes("sitemap_jobs"));
    if (jobSitemaps.length === 0) {
      // Fallback: fetch all child XML sitemaps (non-standard naming)
      jobSitemaps = childLocs.filter((loc) => /\.xml(\?|$)/i.test(loc));
    }
    // Parallel shard fetches — GC has 4 shards; sequential costs ~12s vs ~3s parallel
    const shardResults = await Promise.allSettled(jobSitemaps.map((loc) => fetchText(loc)));
    for (const result of shardResults) {
      if (result.status === "rejected") continue;
      for (const u of extractLocs(result.value)) {
        if (jobPathFromJobUrl(u)) set.add(u);
      }
    }
  } else {
    for (const u of extractLocs(indexXml)) {
      if (jobPathFromJobUrl(u)) set.add(u);
    }
  }

  return [...set].sort();
}

/**
 * Extract buildId from HTML. Uses /companies (133KB) instead of /jobs (271KB) —
 * both embed the same __NEXT_DATA__ buildId.
 */
async function fetchBuildId(origin: string): Promise<string> {
  const html = await fetchText(`${origin}/companies`);
  const m = html.match(/"buildId":"([^"]+)"/);
  if (!m?.[1]) throw new Error(`getro: could not read buildId from ${origin}/companies`);
  return m[1];
}

function salaryPeriodFromGetro(raw: string | null | undefined): SalaryPeriod | null {
  if (!raw) return null;
  const v = raw.toLowerCase();
  if (v === "period_not_defined" || v === "other") return null;
  if (v.includes("year")) return "year";
  if (v.includes("month")) return "month";
  if (v.includes("hour")) return "hour";
  return null;
}

function workplaceFromJob(job: GetroCurrentJob, locStr: string | null): WorkplaceType | null {
  // workMode is null in the detail endpoint. Remote jobs carry "Remote" as a named
  // location instead, which normalizeWorkplaceType detects via the location fallback.
  const w = job.workMode?.toLowerCase();
  if (w === "remote") return "remote";
  if (w === "hybrid") return "hybrid";
  if (w === "on_site" || w === "onsite") return "on_site";
  return normalizeWorkplaceType(null, locStr);
}

function currentJobToNormalized(job: GetroCurrentJob, source: SourceRow): NormalizedJob | null {
  if (job.id == null) return null;
  // Skip non-active jobs that may have leaked into the sitemap
  if (job.status && job.status !== "active") return null;

  const org = job.organization;
  const locNames = (job.locations ?? []).map((l) => l.name).filter(Boolean) as string[];
  const locStr = locNames.length > 0 ? locNames.join("; ") : null;

  // Respect the employer's choice to hide compensation from the public board
  const salaryVisible = job.compensationPublic !== false;
  const salMin = salaryVisible && job.compensationAmountMinCents != null
    ? job.compensationAmountMinCents / 100
    : null;
  const salMax = salaryVisible && job.compensationAmountMaxCents != null
    ? job.compensationAmountMaxCents / 100
    : null;

  const empTypes = job.employmentTypes ?? [];
  const empType = empTypes.length > 0
    ? normalizeEmploymentType(empTypes[0])
    : normalizeEmploymentType(null);

  return {
    external_id: String(job.id),
    title: job.title?.trim() || "Untitled",
    location: normalizeLocation(locStr),
    employment_type: empType,
    workplace_type: workplaceFromJob(job, locStr),
    apply_url: job.url?.trim() || source.base_url,
    source_url: job.url?.trim() ?? null,
    description_raw: job.description?.trim() || null,
    salary_min: salMin,
    salary_max: salMax,
    salary_currency: salaryVisible ? (job.compensationCurrency ?? null) : null,
    salary_period: salaryVisible ? salaryPeriodFromGetro(job.compensationPeriod) : null,
    posted_at: parseEpochSeconds(job.postedAt),
    company_name: org?.name?.trim() || "Unknown",
    company_logo_url: org?.logoUrl ?? null,
    company_website_url: org?.domain
      ? `https://${org.domain.replace(/^https?:\/\//, "")}`
      : null,
  };
}

/**
 * Fetch a single job's detail JSON.
 * Returns null on any HTTP error (including 404 from stale buildId).
 * The caller is responsible for detecting a full-batch-null scenario.
 */
async function fetchJobJson(
  origin: string,
  buildId: string,
  path: string
): Promise<GetroCurrentJob | null> {
  const url = `${origin}/_next/data/${buildId}${path}.json`;
  const res = await fetch(url, { headers: { ...HEADERS, Accept: "application/json" } });
  if (!res.ok) return null;
  const json = (await res.json()) as GetroPageJson;
  return json.pageProps?.initialState?.jobs?.currentJob ?? null;
}

/** Run fn over items in serial waves of chunkSize for controlled concurrency. */
async function mapInChunks<T, R>(
  items: T[],
  chunkSize: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    const part = await Promise.all(items.slice(i, i + chunkSize).map(fn));
    out.push(...part);
  }
  return out;
}

// ─── Fetcher ─────────────────────────────────────────────────────────────────

export const getroFetcher: JobSource = {
  sourceType: "getro",

  async fetch(source: SourceRow, env?: Env): Promise<NormalizedJob[]> {
    let origin: string;
    try {
      origin = new URL(source.base_url).origin;
    } catch {
      throw new Error(`getro: invalid base_url ${source.base_url}`);
    }

    const urls = await discoverJobUrls(origin);
    if (urls.length === 0) return [];

    const sig = listSig(urls);
    let offset = 0;

    if (env?.RATE_LIMIT_KV) {
      const raw = await env.RATE_LIMIT_KV.get(`${KV_CURSOR_PREFIX}${source.id}`);
      if (raw) {
        try {
          const c = JSON.parse(raw) as { offset?: number; sig?: string };
          if (c.sig === sig && typeof c.offset === "number" && c.offset >= 0) {
            offset = c.offset % urls.length;
          }
        } catch {
          offset = 0;
        }
      }
    }

    const end = Math.min(offset + GETRO_JOBS_PER_RUN, urls.length);
    const slice = urls.slice(offset, end);

    // Fetch buildId only after confirming we have URLs to process
    const buildId = await fetchBuildId(origin);

    const paths = slice
      .map((u) => jobPathFromJobUrl(u))
      .filter((p): p is string => p != null);

    const rawOrNull = await mapInChunks(paths, GETRO_CONCURRENCY, (path) =>
      fetchJobJson(origin, buildId, path)
    );

    // Guard against stale buildId silently advancing the cursor past all jobs.
    // If nearly every fetch returned null, the buildId likely rotated since we
    // read it; throw so the caller records an error and the cursor stays put.
    const nullCount = rawOrNull.filter((j) => j === null).length;
    if (paths.length > 0 && nullCount / paths.length >= STALE_BUILD_NULL_THRESHOLD) {
      throw new Error(
        `getro: ${nullCount}/${paths.length} detail fetches returned null for ${origin} ` +
        `— possible stale buildId "${buildId}"`
      );
    }

    const jobs: NormalizedJob[] = [];
    for (const cj of rawOrNull) {
      if (!cj) continue;
      const normalized = currentJobToNormalized(cj, source);
      if (normalized) jobs.push(normalized);
    }

    if (env?.RATE_LIMIT_KV) {
      const nextOffset = end >= urls.length ? 0 : end;
      await env.RATE_LIMIT_KV.put(
        `${KV_CURSOR_PREFIX}${source.id}`,
        JSON.stringify({ offset: nextOffset, sig }),
        { expirationTtl: 60 * 60 * 24 * 90 }
      );
    }

    return jobs;
  },
};
