/**
 * Symphony Talent (Radancy) — WordPress "CWS" job search widget backed by SmartPost.
 * Public listings use `GET https://jobsapi-internal.m-cloud.io/api/job` with query param
 * `Organization` (numeric org id from `cws_opts.org` in page source). The browser uses JSONP;
 * the same endpoint returns raw JSON without a `callback` param.
 *
 * Apply/detail URLs on the marketing site follow `CWS.seo_url` in `cws.js`:
 *   `{origin}{job_detail_path}/{id}/{slug}/`
 * e.g. Bath & Body Works: `/en/job/22823497/retail-supervisor-aventura-mall-aventura-fl/`
 *
 * `base_url` must be any URL on the careers host, with required query param:
 *   `mcloud_org` — Organization id (e.g. `1107` for Bath & Body Works).
 * Optional:
 *   `job_path` — job detail path prefix (default `/en/job`).
 *   `mcloud_company_name` — override `company_name` on normalized jobs (API often returns a parent legal name like "L Brands").
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
const MCLOUD_JOB_API = "https://jobsapi-internal.m-cloud.io/api/job";
const PAGE_SIZE = 100;
/** Bounds runaway pagination if totalHits is wrong. */
const MAX_PAGES_SAFETY = 400;

interface McloudJob {
  id: number;
  company_name?: string;
  title?: string;
  ref?: string;
  description?: string | null;
  primary_city?: string | null;
  primary_state?: string | null;
  primary_country?: string | null;
  primary_zip?: string | null;
  open_date?: string | null;
  job_type?: string | null;
  location_type?: string | null;
  salary?: string | null;
  entity_status?: string | null;
}

interface McloudSearchResponse {
  totalHits: number;
  queryResult: McloudJob[];
}

function parseConfig(baseUrl: string): {
  origin: string;
  org: string;
  jobPath: string;
  companyNameOverride: string | null;
} | null {
  try {
    const u = new URL(baseUrl.trim());
    const org = u.searchParams.get("mcloud_org");
    if (!org) return null;
    const jobPath = u.searchParams.get("job_path")?.trim() || "/en/job";
    const companyNameOverride = u.searchParams.get("mcloud_company_name")?.trim() || null;
    return { origin: u.origin, org, jobPath, companyNameOverride };
  } catch {
    return null;
  }
}

/** Mirrors `CWS.seo_url` in `cws.js` (slug for the job detail path). */
function seoSlug(job: McloudJob): string {
  let url = (job.title ?? "").trim();
  const lt = (job.location_type ?? "").trim();
  if (lt === "Nationwide") {
    if (job.primary_country) url += ` ${job.primary_country}`;
    url += " nationwide";
  } else if (lt === "Statewide") {
    if (job.primary_state) url += ` ${job.primary_state}`;
    url += " statewide";
  } else if (lt === "Remote") {
    url += " remote";
  } else if (lt === "Onsite" || lt === "On-site") {
    url += " onsite";
  } else if ((job.primary_country ?? "").toUpperCase() === "US") {
    url += ` ${(job.primary_city ?? "").trim()}${job.primary_state ? ` ${job.primary_state}` : ""}`;
  } else {
    url += ` ${(job.primary_city ?? "").trim()} ${(job.primary_country ?? "").trim()}`;
  }
  url = url.toLowerCase().trim();
  url = url.replace(/[^a-z0-9]+/gi, "-");
  url = url.replace(/-{2,20}/g, "-");
  return `${url}/`;
}

function jobLocation(job: McloudJob): string | null {
  const city = (job.primary_city ?? "").trim();
  const st = (job.primary_state ?? "").trim();
  const cc = (job.primary_country ?? "").trim();
  if (cc === "US" && city && st) return normalizeLocation(`${city}, ${st}`);
  if (city && st) return normalizeLocation(`${city}, ${st}`);
  if (city && cc) return normalizeLocation(`${city}, ${cc}`);
  if (city) return normalizeLocation(city);
  return null;
}

function buildApplyUrl(origin: string, jobPath: string, job: McloudJob): string {
  const path = jobPath.startsWith("/") ? jobPath : `/${jobPath}`;
  const base = `${origin.replace(/\/$/, "")}${path.replace(/\/$/, "")}`;
  return `${base}/${job.id}/${seoSlug(job)}`;
}

function toNormalized(
  job: McloudJob,
  origin: string,
  jobPath: string,
  companyNameOverride: string | null
): NormalizedJob | null {
  if (job.entity_status && job.entity_status.toLowerCase() !== "open") return null;
  const title = (job.title ?? "").trim();
  if (!title || !Number.isFinite(job.id)) return null;

  const companyName =
    companyNameOverride ?? ((job.company_name ?? "").trim() || "Employer");
  const applyUrl = buildApplyUrl(origin, jobPath, job);
  const desc = (job.description ?? "").trim();
  const wp = normalizeWorkplaceType(job.location_type ?? undefined);
  const et = normalizeEmploymentType(job.job_type ?? undefined);

  return {
    external_id: String(job.id),
    title,
    location: jobLocation(job),
    employment_type: et,
    workplace_type: wp,
    apply_url: applyUrl,
    source_url: applyUrl,
    description_raw: desc ? htmlToText(desc) : null,
    salary_min: null,
    salary_max: null,
    salary_currency: null,
    salary_period: null,
    posted_at: parseEpochSeconds(job.open_date ?? undefined),
    company_name: companyName,
  };
}

async function fetchPage(org: string, offset: number): Promise<McloudSearchResponse> {
  const u = new URL(MCLOUD_JOB_API);
  u.searchParams.set("Organization", org);
  u.searchParams.set("Limit", String(PAGE_SIZE));
  u.searchParams.set("offset", String(offset));
  u.searchParams.set("sortfield", "open_date");
  u.searchParams.set("sortorder", "descending");

  const res = await fetch(u.toString(), {
    headers: { Accept: "application/json", "User-Agent": USER_AGENT },
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`symphony_mcloud: HTTP ${res.status}: ${errText.slice(0, 200)}`);
  }
  return (await res.json()) as McloudSearchResponse;
}

export const symphonyMcloudFetcher: JobSource = {
  sourceType: "symphony_mcloud",

  async fetch(source: SourceRow): Promise<NormalizedJob[]> {
    const cfg = parseConfig(source.base_url);
    if (!cfg) {
      throw new Error(
        `symphony_mcloud: base_url must include mcloud_org= (e.g. https://careers.example.com/?mcloud_org=1107)`
      );
    }

    const { origin, org, jobPath, companyNameOverride } = cfg;
    const out: NormalizedJob[] = [];
    const seen = new Set<string>();

    let offset = 1;
    let page = 0;
    while (page < MAX_PAGES_SAFETY) {
      const data = await fetchPage(org, offset);
      const rows = data.queryResult ?? [];
      const total = data.totalHits ?? 0;
      if (rows.length === 0) break;

      for (const row of rows) {
        const id = String(row.id);
        if (seen.has(id)) continue;
        seen.add(id);
        const j = toNormalized(row, origin, jobPath, companyNameOverride);
        if (j) out.push(j);
      }

      offset += rows.length;
      page++;
      if (offset > total || rows.length < PAGE_SIZE) break;
    }

    return out;
  },
};
