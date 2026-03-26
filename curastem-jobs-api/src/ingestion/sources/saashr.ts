/**
 * Thanks for using Curastem! Curastem is a 501(c)(3) non-profit dedicated to connecting
 * high-quality talent with job opportunities. Our mission is to serve underserved job
 * applicants and support local communities. Consider joining us on this mission. Questions?
 * Contact developers@curastem.org
 *
 * UKG / SaaSHR tenant career portal fetcher.
 *
 * SaaSHR (now UKG Ready) is an HCM platform used by nonprofits, healthcare
 * orgs, and mid-market employers. Career portals are hosted at URLs like:
 *   https://secure6.saashr.com/ta/{compId}.careers?CareersSearch=&lang=en-US
 *
 * The SPA's internal HTTP client uses BASE_URL = "/ta/rest" and builds paths
 * like /ui/recruitment/companies/|{compId}/job-requisitions. The leading pipe
 * character is how the platform distinguishes company-number lookups from
 * short-name lookups. Without it, the API returns 403.
 *
 * The list endpoint is unauthenticated — no session cookie or API key needed.
 * The detail endpoint is used to get the full HTML job description (the list
 * response truncates it).
 *
 * List:   GET /ta/rest/ui/recruitment/companies/%7C{compId}/job-requisitions
 *         ?offset=0&size=100&lang=en-US
 *         → { job_requisitions: [...], _paging: { offset, size, total } }
 *
 * Detail: GET /ta/rest/ui/recruitment/companies/%7C{compId}/job-requisitions/{id}
 *         ?lang=en-US
 *         → full job object with HTML job_description
 *
 * Apply URL pattern (from the SPA source):
 *   {origin}/ta/{compId}.careers?ApplyToJob={jobId}
 */

import type { JobSource, NormalizedJob, SourceRow } from "../../types.ts";
import {
  normalizeEmploymentType,
  normalizeLocation,
  normalizeWorkplaceType,
} from "../../utils/normalize.ts";

interface SaaSHRLocation {
  city?: string;
  state?: string;
  country?: string;
  address_line_1?: string;
  zip?: string;
}

interface SaaSHREmployeeType {
  id: number;
  name: string; // "Exempt" | "Non-Exempt" | "Part-Time" | etc.
}

interface SaaSHRJob {
  id: number;
  job_title: string;
  location?: SaaSHRLocation;
  is_remote_job?: boolean;
  employee_type?: SaaSHREmployeeType;
  job_categories?: string[];
  base_pay_from?: number;
  base_pay_to?: number;
  base_pay_frequency?: string; // "YEAR" | "HOUR" | "MONTH"
  job_description?: string;    // HTML; truncated on list, full on detail
}

interface SaaSHRListResponse {
  job_requisitions: SaaSHRJob[];
  _paging: { offset: number; size: number; total: number };
}

/** Extract compId and origin from a SaaSHR careers URL. */
function parseCareerUrl(baseUrl: string): { origin: string; compId: string } | null {
  try {
    const u = new URL(baseUrl);
    // pathname is /ta/{compId}.careers
    const match = u.pathname.match(/^\/ta\/(\d+)\.careers/);
    if (!match) return null;
    return { origin: u.origin, compId: match[1] };
  } catch {
    return null;
  }
}

function buildLocationString(loc: SaaSHRLocation | undefined): string | null {
  if (!loc) return null;
  const parts = [loc.city, loc.state].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : null;
}

const FREQUENCY_MAP: Record<string, string> = {
  YEAR: "year",
  MONTH: "month",
  HOUR: "hour",
};

/** Map SaaSHR employee_type.name to a canonical EmploymentType. */
function mapEmployeeType(name: string | undefined): string | null {
  if (!name) return null;
  const n = name.toLowerCase();
  if (n.includes("part")) return "part_time";
  if (n.includes("contract") || n.includes("temp")) return "contract";
  if (n.includes("intern")) return "internship";
  // "Exempt" and "Non-Exempt" are FLSA classifications, not employment types.
  // They both map to full_time in the absence of other signals.
  if (n.includes("exempt")) return "full_time";
  return null;
}

const HEADERS = {
  "User-Agent": "Curastem-Jobs-Ingestion/1.0 (developers@curastem.org)",
  "Accept": "application/json",
};

const PAGE_SIZE = 100;

export const saashrFetcher: JobSource = {
  sourceType: "saashr",

  async fetch(source: SourceRow): Promise<NormalizedJob[]> {
    const parsed = parseCareerUrl(source.base_url);
    if (!parsed) {
      throw new Error(`saashr: cannot parse careers URL: ${source.base_url}`);
    }
    const { origin, compId } = parsed;
    const apiBase = `${origin}/ta/rest/ui/recruitment/companies/%7C${compId}`;

    // Paginate through all job requisitions.
    const allJobs: SaaSHRJob[] = [];
    let offset = 0;
    let total = Infinity;

    while (offset < total) {
      const url = `${apiBase}/job-requisitions?offset=${offset}&size=${PAGE_SIZE}&lang=en-US`;
      const res = await fetch(url, { headers: HEADERS });
      if (!res.ok) {
        throw new Error(`saashr: list API ${res.status} for ${source.company_handle}`);
      }
      const data = (await res.json()) as SaaSHRListResponse;
      total = data._paging?.total ?? data.job_requisitions.length;
      allJobs.push(...data.job_requisitions);
      offset += data.job_requisitions.length;
      if (data.job_requisitions.length === 0) break;
    }

    const jobs: NormalizedJob[] = [];

    for (const job of allJobs) {
      try {
        // Fetch full description from the detail endpoint.
        // The list response truncates job_description; the detail has full HTML.
        let descriptionHtml = job.job_description ?? null;
        if (!descriptionHtml || descriptionHtml.endsWith("...")) {
          const detailUrl = `${apiBase}/job-requisitions/${job.id}?lang=en-US`;
          const dr = await fetch(detailUrl, { headers: HEADERS });
          if (dr.ok) {
            const detail = (await dr.json()) as SaaSHRJob;
            descriptionHtml = detail.job_description ?? descriptionHtml;
          }
        }

        const locationStr = buildLocationString(job.location);
        const isRemote = job.is_remote_job ?? false;
        const workplaceRaw = isRemote ? "remote" : locationStr;

        const salaryPeriod = FREQUENCY_MAP[job.base_pay_frequency ?? ""] ?? null;

        const applyUrl = `${origin}/ta/${compId}.careers?ApplyToJob=${job.id}`;
        const sourceUrl = `${origin}/ta/${compId}.careers?ShowJob=${job.id}`;

        jobs.push({
          external_id: String(job.id),
          title: job.job_title.trim(),
          location: normalizeLocation(locationStr),
          employment_type: normalizeEmploymentType(mapEmployeeType(job.employee_type?.name)),
          workplace_type: normalizeWorkplaceType(workplaceRaw, locationStr),
          apply_url: applyUrl,
          source_url: sourceUrl,
          description_raw: descriptionHtml,
          salary_min: job.base_pay_from ?? null,
          salary_max: job.base_pay_to ?? null,
          salary_currency: "USD",
          salary_period: salaryPeriod as import("../../types.ts").SalaryPeriod | null,
          posted_at: null, // SaaSHR list/detail API does not expose a posting date
          company_name: source.name.replace(/\s*\(SaaSHR\)\s*/i, "").trim(),
          company_logo_url: null,
          company_website_url: null,
        });
      } catch {
        continue;
      }
    }

    return jobs;
  },
};
