/**
 * Thanks for using Curastem! Curastem is a 501(c)(3) non-profit dedicated to connecting
 * high-quality talent with job opportunities. Our mission is to serve underserved job
 * applicants and support local communities. Consider joining us on this mission. Questions?
 * Contact developers@curastem.org
 *
 * Oracle Fusion Cloud HCM — Candidate Experience public REST (recruiting CE).
 *
 * The hosted job search UI calls the same unauthenticated ADF REST collections the SPA uses:
 *   GET {origin}/hcmRestApi/resources/latest/recruitingCEJobRequisitions  — search / list
 *   GET {origin}/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails — full posting (finder `ById;Id={id}`)
 *
 * Most tenants use list-only ingestion (ShortDescriptionStr). **Marriott** and **Honeywell** list rows
 * often omit short copy; those sources batch `ById` detail calls for `ExternalDescriptionStr`, then
 * **`htmlToText`** (same helper as AI enrichment) so `description_raw` is plain text, not markup.
 * There is no separate “apply URL” in the JSON: apply starts from the CE job page (same URL we store).
 *
 * Finder `findReqs` expects bind variables as a comma-separated list of `key=value` pairs
 * after a semicolon (this replaces `:findParams:` in the Oracle front-end URL templates).
 * See Oracle's `describe` on that collection for the full bind list.
 *
 * `base_url` must be a Candidate Experience **sites** page, e.g.
 *   https://tenant.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001
 * Locale and site number are taken from the path.
 */

import type { JobSource, NormalizedJob, SourceRow } from "../../types.ts";
import {
  htmlToText,
  normalizeEmploymentType,
  normalizeLocation,
  normalizeWorkplaceType,
  parseEpochSeconds,
} from "../../utils/normalize.ts";

const USER_AGENT = "Curastem-Jobs-Ingestion/1.0 (developers@curastem.org)";

/** Align with `enrichment/ai.ts` — store plain text in `description_raw`, not HTML. */
function descriptionRawFromMaybeHtml(raw: string | null | undefined): string | null {
  if (raw == null || !String(raw).trim()) return null;
  const t = htmlToText(String(raw));
  return t.length > 0 ? t : null;
}

/** Matches Oracle's `_encodeString` in the CE bundle (module 54502). */
function encodeOracleString(s: string): string {
  return encodeURIComponent(s)
    .replace(/!/g, "%21")
    .replace(/'/g, "%27")
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29")
    .replace(/~/g, "%7E");
}

/** Matches Oracle CE `_encodeObject` — skips falsy `e[k]` (including 0 and ""). */
function encodeFindParamsSegment(params: Record<string, string | number | undefined>): string {
  return Object.keys(params)
    .filter((k) => {
      const v = params[k];
      if (v === null || v === undefined) return false;
      if (typeof v === "number") return v !== 0;
      return v !== "";
    })
    .map((k) => `${k}=${encodeOracleString(String(params[k]))}`)
    .join(",");
}

function buildFindReqsFinder(segment: string): string {
  return `findReqs;${segment}`;
}

interface CxParsed {
  origin: string;
  locale: string;
  siteNumber: string;
}

function parseCandidateExperienceUrl(baseUrl: string): CxParsed {
  let u: URL;
  try {
    u = new URL(baseUrl);
  } catch {
    throw new Error(`oracle_ce: invalid base_url ${baseUrl}`);
  }
  const m = u.pathname.match(/\/CandidateExperience\/([a-z]{2})\/sites\/([^/?]+)/i);
  if (!m) {
    throw new Error(
      "oracle_ce: base_url must include /CandidateExperience/{lang}/sites/{siteNumber} (open the careers site in a browser and copy the URL)"
    );
  }
  return { origin: u.origin, locale: m[1].toLowerCase(), siteNumber: m[2] };
}

interface OracleSearchItem {
  TotalJobsCount?: number;
  Offset?: number;
  SiteNumber?: string;
  requisitionList?: OracleReqRow[];
}

interface OracleReqRow {
  Id: string;
  Title: string;
  PostedDate?: string;
  PrimaryLocation?: string;
  ShortDescriptionStr?: string | null;
  WorkplaceType?: string | null;
  WorkplaceTypeCode?: string | null;
  JobSchedule?: string | null;
}

interface OracleSearchResponse {
  items?: OracleSearchItem[];
}

interface OracleDetailItem {
  ExternalDescriptionStr?: string | null;
  ShortDescriptionStr?: string | null;
}

interface OracleDetailResponse {
  items?: OracleDetailItem[];
}

const PAGE_SIZE = 100;
/**
 * Safety cap. Per-job detail calls (recruitingCEJobRequisitionDetails) are skipped —
 * see note below — so this purely limits list pagination.
 */
const MAX_PAGES = 1000;

/** Marriott list rows often omit ShortDescriptionStr; detail API returns full HTML for AI enrichment. */
const DETAIL_FETCH_CONCURRENCY = 28;

async function parallelMap<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

/** Full posting HTML from `recruitingCEJobRequisitionDetails` finder `ById;Id={requisitionId}`. */
async function fetchExternalDescriptionHtml(origin: string, jobId: string): Promise<string | null> {
  const finder = encodeURIComponent(`ById;Id=${jobId}`);
  const url = `${origin}/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails?onlyData=true&finder=${finder}`;
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as OracleDetailResponse;
  const row = data.items?.[0];
  const html = (row?.ExternalDescriptionStr ?? row?.ShortDescriptionStr ?? "").trim();
  return html.length > 0 ? html : null;
}

export const oracleCeFetcher: JobSource = {
  sourceType: "oracle_ce",

  async fetch(source: SourceRow): Promise<NormalizedJob[]> {
    const { origin, locale, siteNumber } = parseCandidateExperienceUrl(source.base_url);
    const restBase = `${origin}/hcmRestApi/resources/latest/recruitingCEJobRequisitions`;
    const companyName = source.name.replace(/\s*\(Oracle CE\)\s*/i, "").trim();
    /** Large tenants skip N detail HTTP calls; Marriott/Honeywell list payloads omit descriptions — hydrate via REST. */
    const fetchPostingHtml =
      source.company_handle === "marriott" ||
      source.id === "ce-marriott" ||
      source.company_handle === "honeywell" ||
      source.id === "oc-honeywell" ||
      source.id === "oc-pizzahut";

    const jobs: NormalizedJob[] = [];
    let offset = 0;
    let totalJobs = Infinity;
    let page = 0;

    while (offset < totalJobs && page < MAX_PAGES) {
      page += 1;
      const findParams: Record<string, string | number | undefined> = {
        siteNumber,
        facetsList: "jobs",
        limit: PAGE_SIZE,
      };
      if (offset > 0) findParams.offset = offset;

      const finder = buildFindReqsFinder(encodeFindParamsSegment(findParams));
      const finderEncoded = encodeURIComponent(finder);
      const url =
        `${restBase}?onlyData=true&expand=requisitionList.secondaryLocations&finder=${finderEncoded}`;

      const res = await fetch(url, {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "application/json",
        },
      });

      if (!res.ok) {
        throw new Error(`Oracle CE REST ${res.status} for ${source.company_handle} (offset ${offset})`);
      }

      const data = (await res.json()) as OracleSearchResponse;
      const [item] = data.items ?? [];
      if (!item) break;

      if (typeof item.TotalJobsCount === "number") {
        totalJobs = item.TotalJobsCount;
      }

      const batch = item.requisitionList ?? [];
      if (batch.length === 0) break;

      // Detail fetches are skipped for most tenants (Kroger-scale volume). Marriott enables
      // `fetchPostingHtml` — parallel ById calls fill ExternalDescriptionStr HTML for lazy-load AI.
      for (const row of batch) {
        try {
          const loc = row.PrimaryLocation ?? null;
          const wpHint = row.WorkplaceTypeCode ?? row.WorkplaceType ?? null;
          const jobPath = `/hcmUI/CandidateExperience/${locale}/sites/${siteNumber}/job/${row.Id}`;
          const applyUrl = `${origin}${jobPath}`;

          jobs.push({
            external_id: row.Id,
            title: row.Title,
            location: normalizeLocation(loc),
            employment_type: normalizeEmploymentType(row.JobSchedule ?? null),
            workplace_type: normalizeWorkplaceType(wpHint, loc),
            apply_url: applyUrl,
            source_url: applyUrl,
            description_raw: descriptionRawFromMaybeHtml(row.ShortDescriptionStr),
            salary_min: null,
            salary_max: null,
            salary_currency: null,
            salary_period: null,
            posted_at: parseEpochSeconds(row.PostedDate ?? null),
            company_name: companyName,
            company_logo_url: null,
            company_website_url: null,
          });
        } catch {
          continue;
        }
      }

      offset += batch.length;
      // Do not stop on short pages alone — some tenants return fewer than `limit` before the last page.
      if (offset >= totalJobs) break;
    }

    if (!fetchPostingHtml || jobs.length === 0) {
      return jobs;
    }

    return parallelMap(jobs, DETAIL_FETCH_CONCURRENCY, async (job) => {
      const html = await fetchExternalDescriptionHtml(origin, job.external_id);
      const text = descriptionRawFromMaybeHtml(html);
      if (text) return { ...job, description_raw: text };
      return job;
    });
  },
};
