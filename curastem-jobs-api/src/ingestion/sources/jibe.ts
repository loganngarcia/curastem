/**
 * iCIMS Jibe career sites (Angular boards with `data-jibe-search-version`).
 *
 * Public JSON: `GET {origin}/api/jobs?page=N&limit=M` — full HTML descriptions in each row
 * (`data.description`, sometimes `job_description`). Pagination uses 1-based `page` and `totalCount`.
 * When `data.apply_url` is set (often iCIMS), it is used for `apply_url` / `source_url` instead of guessing `/jobs/{req_id}`.
 *
 * `base_url` must be the branded site origin used in the UI, e.g.
 *   `https://jobs.sprouts.com`
 *   `https://careers.ulta.com`
 * so job URLs match what candidates see (Ulta uses `/careers/jobs/{req_id}`, Sprouts `/jobs/{req_id}`).
 */

import type { JobSource, NormalizedJob, SourceRow } from "../../types.ts";
import {
  normalizeEmploymentType,
  normalizeLocation,
  normalizeWorkplaceType,
  parseEpochSeconds,
  parseSalary,
} from "../../utils/normalize.ts";

/** Match Workday preflight — some Jibe tenants sit behind CDNs that treat bare bot UAs as lower trust. */
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const PAGE_SIZE = 100;
/** Safety cap — 100 pages × 100 jobs */
const MAX_PAGES = 150;

interface JibeJobData {
  slug?: string;
  req_id?: string | number;
  title?: string;
  description?: string | null;
  /** Some tenants use alternate keys; list response usually still has full HTML. */
  job_description?: string | null;
  html_description?: string | null;
  /** When present, points at iCIMS or the employer apply flow — prefer over synthetic `/jobs/{id}`. */
  apply_url?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  location_name?: string | null;
  employment_type?: string | null;
  posted_date?: string | null;
  /** Often a string; some tenants send a number — never call `.trim()` blindly. */
  salary_value?: string | number | null;
}

interface JibeJobRow {
  data?: JibeJobData;
}

interface JibeJobsResponse {
  jobs?: JibeJobRow[];
  totalCount?: number;
}

function stripParenSuffix(name: string): string {
  return name.replace(/\s*\([^)]*Jibe[^)]*\)\s*/i, "").trim();
}

function buildLocation(d: JibeJobData): string | null {
  const city = (d.city ?? "").trim();
  const state = (d.state ?? "").trim();
  const locName = (d.location_name ?? "").trim();
  if (city && state) return `${city}, ${state}`;
  if (locName) return locName;
  if (city) return city;
  return null;
}

/** Canonical job posting URL on the branded host (paths differ by tenant). */
function buildJobPageUrl(brandedOrigin: string, reqId: string): string {
  const u = new URL(brandedOrigin);
  const host = u.hostname.toLowerCase();
  if (host === "careers.ulta.com" || host === "ulta.jibeapply.com") {
    return `https://careers.ulta.com/careers/jobs/${reqId}`;
  }
  if (host === "jobs.sprouts.com" || host === "sprouts.jibeapply.com") {
    return `https://jobs.sprouts.com/jobs/${reqId}`;
  }
  if (host === "www.pepsicojobs.com" || host === "pepsicojobs.com") {
    return `https://www.pepsicojobs.com/main/jobs/${reqId}`;
  }
  return `${u.origin}/jobs/${reqId}`;
}

function pickDescriptionHtml(d: JibeJobData): string | null {
  const candidates = [d.description, d.job_description, d.html_description];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return null;
}

/**
 * Prefer `apply_url` from the API (often `*.icims.com/jobs/{id}/login`) so links match the real apply path.
 */
function resolveJobUrls(d: JibeJobData, brandedOrigin: string, reqId: string): { apply_url: string; source_url: string } {
  const raw = d.apply_url?.trim();
  if (raw && /^https?:\/\//i.test(raw)) {
    return { apply_url: raw, source_url: raw };
  }
  const fallback = buildJobPageUrl(brandedOrigin, reqId);
  return { apply_url: fallback, source_url: fallback };
}

function jibeFetchHeaders(apiOrigin: string): Record<string, string> {
  return {
    "User-Agent": BROWSER_UA,
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    Referer: `${apiOrigin}/`,
  };
}

/** Map jibeapply hosts to the public careers origin for URLs and API. */
function resolveBrandedOrigin(baseUrl: string): string {
  let u: URL;
  try {
    u = new URL(baseUrl.trim());
  } catch {
    throw new Error(`jibe: invalid base_url ${baseUrl}`);
  }
  const host = u.hostname.toLowerCase();
  if (host === "sprouts.jibeapply.com") return "https://jobs.sprouts.com";
  if (host === "ulta.jibeapply.com") return "https://careers.ulta.com";
  return u.origin;
}

export const jibeFetcher: JobSource = {
  sourceType: "jibe",

  async fetch(source: SourceRow): Promise<NormalizedJob[]> {
    const brandedOrigin = resolveBrandedOrigin(source.base_url);
    const apiOrigin = new URL(source.base_url.trim()).origin;
    const companyName = stripParenSuffix(source.name);

    const out: NormalizedJob[] = [];
    let page = 1;
    let total = Infinity;

    while (page <= MAX_PAGES && (page - 1) * PAGE_SIZE < total) {
      const url = `${apiOrigin}/api/jobs?page=${page}&limit=${PAGE_SIZE}`;
      const res = await fetch(url, {
        headers: jibeFetchHeaders(apiOrigin),
      });

      if (!res.ok) {
        // Some tenants occasionally 404/429 deep pages; keep jobs already fetched on earlier pages.
        if (page > 1 && (res.status === 404 || res.status === 429 || res.status === 503)) {
          break;
        }
        throw new Error(`Jibe API ${res.status} for ${source.company_handle} (page ${page})`);
      }

      const data = (await res.json()) as JibeJobsResponse;
      if (typeof data.totalCount === "number") {
        total = data.totalCount;
      }

      const batch = data.jobs ?? [];
      if (batch.length === 0) break;

      for (const row of batch) {
        try {
          const d = row.data;
          if (!d?.title) continue;

          const reqRaw = d.req_id ?? d.slug;
          if (reqRaw === undefined || reqRaw === null) continue;
          const reqId = String(reqRaw);

          const locStr = buildLocation(d);
          const locNorm = locStr ? normalizeLocation(locStr) : null;
          const etRaw = d.employment_type?.toLowerCase().replace(/-/g, "_") ?? null;
          const employmentType = normalizeEmploymentType(etRaw ?? undefined);
          const salaryRaw = d.salary_value;
          const salaryHint =
            salaryRaw == null || salaryRaw === ""
              ? null
              : typeof salaryRaw === "string"
                ? salaryRaw.trim() || null
                : String(salaryRaw);
          const salary = parseSalary(salaryHint);

          const { apply_url: applyUrl, source_url: sourceUrl } = resolveJobUrls(d, brandedOrigin, reqId);
          const descriptionRaw = pickDescriptionHtml(d);

          out.push({
            external_id: reqId,
            title: d.title.trim(),
            location: locNorm,
            employment_type: employmentType,
            workplace_type: normalizeWorkplaceType(null, locStr ?? ""),
            apply_url: applyUrl,
            source_url: sourceUrl,
            description_raw: descriptionRaw,
            salary_min: salary.min,
            salary_max: salary.max,
            salary_currency: salary.currency,
            salary_period: salary.period,
            posted_at: parseEpochSeconds(d.posted_date ?? undefined),
            company_name: companyName,
          });
        } catch {
          continue;
        }
      }

      if (batch.length < PAGE_SIZE) break;
      page += 1;
    }

    return out;
  },
};
