/**
 * iCIMS Jibe career sites (Angular boards with `data-jibe-search-version`).
 *
 * Public JSON: `GET {origin}/api/jobs?page=N&limit=M` — full HTML descriptions in each row
 * (`data.description`). Pagination uses 1-based `page` and `totalCount`.
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

const USER_AGENT = "Curastem-Jobs-Ingestion/1.0 (developers@curastem.org)";

const PAGE_SIZE = 100;
/** Safety cap — 100 pages × 100 jobs */
const MAX_PAGES = 150;

interface JibeJobData {
  slug?: string;
  req_id?: string | number;
  title?: string;
  description?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  location_name?: string | null;
  employment_type?: string | null;
  posted_date?: string | null;
  salary_value?: string | null;
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
  return `${u.origin}/jobs/${reqId}`;
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
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "application/json",
        },
      });

      if (!res.ok) {
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
          const salaryHint = d.salary_value?.trim() || null;
          const salary = parseSalary(salaryHint);

          const jobUrl = buildJobPageUrl(brandedOrigin, reqId);

          out.push({
            external_id: reqId,
            title: d.title.trim(),
            location: locNorm,
            employment_type: employmentType,
            workplace_type: normalizeWorkplaceType(null, locStr ?? ""),
            apply_url: jobUrl,
            source_url: jobUrl,
            description_raw: d.description?.trim() || null,
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
