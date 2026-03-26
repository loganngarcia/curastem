/**
 * Oracle Fusion Cloud HCM — Candidate Experience public REST (recruiting CE).
 *
 * The hosted job search UI calls the same unauthenticated ADF REST collections the SPA uses:
 *   GET {origin}/hcmRestApi/resources/latest/recruitingCEJobRequisitions  — search / list
 *   GET {origin}/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails — full posting (finder `ById`)
 *
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
  normalizeEmploymentType,
  normalizeLocation,
  normalizeWorkplaceType,
  parseEpochSeconds,
} from "../../utils/normalize.ts";

const USER_AGENT = "Curastem-Jobs-Ingestion/1.0 (developers@curastem.org)";

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

function buildByIdFinder(segment: string): string {
  return `ById;${segment}`;
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
}

interface OracleSearchResponse {
  items?: OracleSearchItem[];
}

interface OracleDetailRow {
  ExternalDescriptionStr?: string | null;
  ExternalPostedStartDate?: string | null;
  JobSchedule?: string | null;
  ShortDescriptionStr?: string | null;
}

interface OracleDetailResponse {
  items?: OracleDetailRow[];
}

const PAGE_SIZE = 100;
/** Safety cap — ~100k jobs at PAGE_SIZE 100 */
const MAX_PAGES = 1000;
/** Parallel detail GETs per list page (full HTML lives on recruitingCEJobRequisitionDetails only). */
const DETAIL_FETCH_CONCURRENCY = 6;

async function fetchRequisitionDetail(origin: string, requisitionId: string): Promise<OracleDetailRow | null> {
  const base = `${origin}/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails`;
  const finder = buildByIdFinder(encodeFindParamsSegment({ Id: requisitionId }));
  const url = `${base}?onlyData=true&expand=all&finder=${encodeURIComponent(finder)}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/json",
    },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as OracleDetailResponse;
  const [row] = data.items ?? [];
  return row ?? null;
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += limit) {
    const chunk = items.slice(i, i + limit);
    out.push(...await Promise.all(chunk.map((x) => fn(x))));
  }
  return out;
}

export const oracleCeFetcher: JobSource = {
  sourceType: "oracle_ce",

  async fetch(source: SourceRow): Promise<NormalizedJob[]> {
    const { origin, locale, siteNumber } = parseCandidateExperienceUrl(source.base_url);
    const restBase = `${origin}/hcmRestApi/resources/latest/recruitingCEJobRequisitions`;
    const companyName = source.name.replace(/\s*\(Oracle CE\)\s*/i, "").trim();

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

      const details = await mapWithConcurrency(batch, DETAIL_FETCH_CONCURRENCY, (r) =>
        fetchRequisitionDetail(origin, r.Id)
      );

      for (let i = 0; i < batch.length; i++) {
        const row = batch[i];
        const detail = details[i];
        try {
          const loc = row.PrimaryLocation ?? null;
          const wpHint = row.WorkplaceTypeCode ?? row.WorkplaceType ?? null;
          const jobPath = `/hcmUI/CandidateExperience/${locale}/sites/${siteNumber}/job/${row.Id}`;
          const applyUrl = `${origin}${jobPath}`;

          const html =
            detail?.ExternalDescriptionStr
            ?? detail?.ShortDescriptionStr
            ?? row.ShortDescriptionStr
            ?? null;
          const posted = detail?.ExternalPostedStartDate ?? row.PostedDate ?? null;
          const schedule = detail?.JobSchedule ?? null;

          jobs.push({
            external_id: row.Id,
            title: row.Title,
            location: normalizeLocation(loc),
            employment_type: normalizeEmploymentType(schedule),
            workplace_type: normalizeWorkplaceType(wpHint, loc),
            apply_url: applyUrl,
            source_url: applyUrl,
            description_raw: html,
            salary_min: null,
            salary_max: null,
            salary_currency: null,
            salary_period: null,
            posted_at: parseEpochSeconds(posted),
            company_name: companyName,
            company_logo_url: null,
            company_website_url: null,
          });
        } catch {
          continue;
        }
      }

      offset += batch.length;
      if (batch.length < PAGE_SIZE) break;
    }

    return jobs;
  },
};
