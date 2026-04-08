/**
 * ADP Recruiting Management — public Candidate Experience (MyJobs) REST.
 *
 * Flow (same as the Angular SPA):
 * 1. GET `/public/staffing/v1/career-site/{domain}` on `myjobs.adp.com` → `orgoid` + `myJobsToken`
 * 2. GET `apply-custom-filters` on `my.adp.com` with those headers → paginated requisitions + HTML descriptions
 *
 * `base_url` is any MyJobs URL whose first path segment is the career-site domain, e.g.
 * `https://myjobs.adp.com/kendo?c=1178815&d=Kendo` or `.../kendo/cx/job-listing?...`.
 * Query params `c` and `d` are preserved for canonical job-detail links.
 */

import type { JobSource, NormalizedJob, SourceRow } from "../../types.ts";
import {
  normalizeEmploymentType,
  normalizeLocation,
  normalizeWorkplaceType,
  parseEpochSeconds,
} from "../../utils/normalize.ts";

const USER_AGENT = "Curastem-Jobs-Ingestion/1.0 (developers@curastem.org)";
/** Matches the browser client; listing counts are stable across US timezones for this API. */
const DEFAULT_TZ = "America/Los_Angeles";
const PAGE_SIZE = 100;

const SELECT_FIELDS = [
  "reqId",
  "jobTitle",
  "publishedJobTitle",
  "type",
  "jobDescription",
  "jobQualifications",
  "workLocations",
  "workLevelCode",
  "clientRequisitionID",
  "postingDate",
  "requisitionLocations",
].join(",");

const APPLY_FILTERS_URL =
  "https://my.adp.com/myadp_prefix/mycareer/public/staffing/v1/job-requisitions/apply-custom-filters";

interface AdpCareerSiteResponse {
  id: string;
  orgoid: string;
  myJobsToken: string;
}

interface AdpAddress {
  cityName?: string;
  countrySubdivisionLevel1?: { codeValue?: string };
  country?: { codeValue?: string; longName?: string };
}

interface AdpReqLocation {
  primaryIndicator?: boolean;
  address?: AdpAddress;
}

interface AdpJobRequisition {
  reqId: string;
  jobTitle?: string;
  publishedJobTitle?: string;
  jobDescription?: string | null;
  jobQualifications?: string | null;
  postingDate?: string | null;
  requisitionLocations?: AdpReqLocation[];
  type?: string | null;
}

interface AdpApplyFiltersResponse {
  count?: number;
  jobRequisitions?: AdpJobRequisition[];
}

function parseMyJobsBaseUrl(raw: string): { domain: string; extraQuery: string } {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error(`adp_cx: invalid base_url ${raw}`);
  }
  if (url.hostname !== "myjobs.adp.com") {
    throw new Error(`adp_cx: expected hostname myjobs.adp.com, got ${url.hostname}`);
  }
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length === 0) {
    throw new Error("adp_cx: missing career-site domain in path (e.g. /kendo/...)");
  }
  const domain = segments[0];
  const q = new URLSearchParams(url.search);
  const out = new URLSearchParams();
  const c = q.get("c");
  const d = q.get("d");
  if (c) out.set("c", c);
  if (d) out.set("d", d);
  return { domain, extraQuery: out.toString() };
}

function pickPrimaryLocation(locations: AdpReqLocation[] | undefined): AdpReqLocation | null {
  if (!locations?.length) return null;
  const primary = locations.find((l) => l.primaryIndicator);
  return primary ?? locations[0] ?? null;
}

function formatLocation(loc: AdpReqLocation | null): string {
  const a = loc?.address;
  if (!a) return "";
  const city = a.cityName?.trim();
  const st = a.countrySubdivisionLevel1?.codeValue?.trim();
  const country = a.country?.codeValue?.trim();
  if (city && st) return `${city}, ${st}`;
  if (city && country) return `${city}, ${country}`;
  return city ?? "";
}

function buildDetailUrl(domain: string, reqId: string, extraQuery: string): string {
  const path = `https://myjobs.adp.com/${domain}/cx/job-details`;
  const q = new URLSearchParams();
  q.set("r", reqId);
  if (extraQuery) {
    const extra = new URLSearchParams(extraQuery);
    extra.forEach((v, k) => q.set(k, v));
  }
  return `${path}?${q.toString()}`;
}

function mergeDescription(job: AdpJobRequisition): string | null {
  const parts: string[] = [];
  const jd = job.jobDescription?.trim();
  const jq = job.jobQualifications?.trim();
  if (jd) parts.push(jd);
  if (jq) {
    if (parts.length) parts.push("<hr/>");
    parts.push(jq);
  }
  const s = parts.join("\n");
  return s.length ? s : null;
}

export const adpCxFetcher: JobSource = {
  sourceType: "adp_cx",

  async fetch(source: SourceRow): Promise<NormalizedJob[]> {
    const { domain, extraQuery } = parseMyJobsBaseUrl(source.base_url);

    const csUrl = `https://myjobs.adp.com/public/staffing/v1/career-site/${encodeURIComponent(domain)}`;
    const csRes = await fetch(csUrl, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json",
      },
    });
    if (!csRes.ok) {
      throw new Error(`adp_cx career-site ${csRes.status} for ${source.company_handle}`);
    }
    const cs = (await csRes.json()) as AdpCareerSiteResponse;
    const orgoid = cs.orgoid;
    const token = cs.myJobsToken;
    if (!orgoid || !token) {
      throw new Error(`adp_cx: missing orgoid or myJobsToken for ${source.company_handle}`);
    }

    const commonHeaders: Record<string, string> = {
      "User-Agent": USER_AGENT,
      Accept: "application/json",
      orgoid,
      myJobsToken: token,
      Referer: `https://myjobs.adp.com/${domain}/cx/job-listing`,
    };

    const all: AdpJobRequisition[] = [];
    let skip = 0;
    for (;;) {
      const u = new URL(APPLY_FILTERS_URL);
      u.searchParams.set("$select", SELECT_FIELDS);
      u.searchParams.set("$top", String(PAGE_SIZE));
      u.searchParams.set("$skip", String(skip));
      u.searchParams.set("$filter", "");
      u.searchParams.set("tz", DEFAULT_TZ);

      const res = await fetch(u.toString(), { headers: commonHeaders });
      if (!res.ok) {
        throw new Error(`adp_cx apply-custom-filters ${res.status} for ${source.company_handle}`);
      }
      const data = (await res.json()) as AdpApplyFiltersResponse;
      const batch = data.jobRequisitions ?? [];
      all.push(...batch);
      if (batch.length < PAGE_SIZE) break;
      skip += PAGE_SIZE;
    }

    const companyName = source.name.replace(/\s*\(ADP CX\)\s*/i, "").trim();
    const jobs: NormalizedJob[] = [];

    for (const job of all) {
      try {
        const reqId = job.reqId;
        if (!reqId) continue;

        const title = (job.publishedJobTitle ?? job.jobTitle ?? "").trim();
        if (!title) continue;

        const loc = pickPrimaryLocation(job.requisitionLocations);
        const locStr = formatLocation(loc);

        const applyUrl = buildDetailUrl(domain, reqId, extraQuery);

        jobs.push({
          external_id: String(reqId),
          title,
          location: normalizeLocation(locStr),
          employment_type: normalizeEmploymentType(null),
          workplace_type: normalizeWorkplaceType(null, locStr),
          apply_url: applyUrl,
          source_url: applyUrl,
          description_raw: mergeDescription(job),
          salary_min: null,
          salary_max: null,
          salary_currency: null,
          salary_period: null,
          posted_at: parseEpochSeconds(job.postingDate ?? null),
          company_name: companyName,
        });
      } catch {
        continue;
      }
    }

    return jobs;
  },
};
