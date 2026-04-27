/**
 * Recruiterflow-hosted career sites (recruiterflow.com).
 *
 * Listing pages embed `window.jobsList` (JSON with `group` / `department` arrays of
 * `[categoryName, jobs[]]`). Each job has `job_id`, `job_name`, `apply_link`, and
 * short `details` (often location). Full HTML descriptions come from each job page’s
 * `application/ld+json` JobPosting block (same pattern as EasyApply / Meta JSON-LD).
 *
 * `base_url` must be `https://recruiterflow.com/{company_path}/jobs` or a single job URL
 * under that path (normalized to the listing root).
 */

import type { JobSource, NormalizedJob, SourceRow } from "../../types.ts";
import {
  normalizeEmploymentType,
  normalizeLocation,
  normalizeWorkplaceType,
  parseEpochSeconds,
} from "../../utils/normalize.ts";

const USER_AGENT = "Curastem-Jobs-Ingestion/1.0 (developers@curastem.org)";
const DETAIL_CONCURRENCY = 10;

interface RfJobRow {
  job_id: number;
  job_name: string;
  apply_link: string;
  details: string | null;
  employment_type: string | null;
  remote_type: string | null;
  last_opened?: string;
}

interface RfJobsList {
  group?: unknown;
  department?: unknown;
  location?: unknown;
}

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

/** String-aware `{`…`}` slice for JSON embedded in HTML (handles `}` inside strings). */
function extractJsonObjectAfterMarker(html: string, marker: string): unknown | null {
  const startIdx = html.indexOf(marker);
  if (startIdx < 0) return null;
  let i = html.indexOf("{", startIdx + marker.length);
  if (i < 0) return null;
  const sliceStart = i;
  let depth = 0;
  let inStr = false;
  let esc = false;
  let quote: '"' | "'" | null = null;
  for (; i < html.length; i++) {
    const c = html[i];
    if (inStr) {
      if (esc) {
        esc = false;
      } else if (c === "\\") {
        esc = true;
      } else if (quote && c === quote) {
        inStr = false;
        quote = null;
      }
      continue;
    }
    if (c === '"' || c === "'") {
      inStr = true;
      quote = c as '"' | "'";
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(sliceStart, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function normalizeListingUrl(raw: string): string {
  const u = raw.trim();
  const m = u.match(/^(https:\/\/recruiterflow\.com\/[^/]+)\/jobs(?:\/\d+)?(?:\?[^#]*)?(?:#.*)?$/i);
  if (!m) {
    throw new Error(
      "recruiterflow: base_url must be https://recruiterflow.com/{company_path}/jobs (or a job URL under that path)",
    );
  }
  return `${m[1]}/jobs`;
}

function toAbsoluteApplyUrl(applyLink: string): string {
  const s = applyLink.trim();
  if (s.startsWith("http://") || s.startsWith("https://")) return s;
  return `https://recruiterflow.com/${s.replace(/^\/+/, "")}`;
}

function flattenJobs(jobsList: RfJobsList): RfJobRow[] {
  const map = new Map<number, RfJobRow>();
  const buckets: unknown[] = [];
  if (Array.isArray(jobsList.group)) buckets.push(...jobsList.group);
  if (Array.isArray(jobsList.department)) buckets.push(...jobsList.department);
  for (const row of buckets) {
    if (!Array.isArray(row) || row.length < 2) continue;
    const jobs = row[1];
    if (!Array.isArray(jobs)) continue;
    for (const j of jobs) {
      if (!j || typeof j !== "object") continue;
      const o = j as Record<string, unknown>;
      const id = typeof o.job_id === "number" ? o.job_id : Number(o.job_id);
      if (!Number.isFinite(id)) continue;
      map.set(id, {
        job_id: id,
        job_name: String(o.job_name ?? "").trim() || `Job ${id}`,
        apply_link: String(o.apply_link ?? ""),
        details: o.details == null ? null : String(o.details),
        employment_type: o.employment_type == null ? null : String(o.employment_type),
        remote_type: o.remote_type == null ? null : String(o.remote_type),
        last_opened: o.last_opened == null ? undefined : String(o.last_opened),
      });
    }
  }
  return [...map.values()];
}

interface JobPostingLd {
  title?: string;
  description?: string;
  datePosted?: string;
  employmentType?: string;
  hiringOrganization?: { logo?: string };
  jobLocation?: {
    address?: {
      addressLocality?: string;
      addressRegion?: string;
      addressCountry?: string;
    };
  };
}

function parseJobPostingLd(html: string): JobPostingLd | null {
  const re = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    try {
      const j = JSON.parse(m[1]) as Record<string, unknown>;
      if (j["@type"] === "JobPosting") {
        return j as unknown as JobPostingLd;
      }
    } catch {
      /* try next block */
    }
  }
  return null;
}

function schemaEmploymentToNormalized(raw: string | null | undefined): ReturnType<typeof normalizeEmploymentType> {
  if (!raw) return null;
  const key = raw.toLowerCase().replace(/_/g, " ").trim();
  return normalizeEmploymentType(key);
}

function formatLdLocation(ld: JobPostingLd): string | null {
  const a = ld.jobLocation?.address;
  if (!a) return null;
  const parts = [a.addressLocality, a.addressRegion, a.addressCountry].filter(Boolean).map(String);
  return parts.length ? parts.join(", ") : null;
}

export const recruiterflowFetcher: JobSource = {
  sourceType: "recruiterflow",

  async fetch(source: SourceRow): Promise<NormalizedJob[]> {
    const listingUrl = normalizeListingUrl(source.base_url);
    const res = await fetch(listingUrl, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,*/*",
      },
      redirect: "follow",
    });
    if (!res.ok) {
      throw new Error(`recruiterflow: listing ${res.status} for ${source.company_handle}`);
    }
    const html = await res.text();
    const jobsList = extractJsonObjectAfterMarker(html, "window.jobsList = ") as RfJobsList | null;
    if (!jobsList) {
      throw new Error(`recruiterflow: could not parse window.jobsList (${listingUrl})`);
    }
    const rows = flattenJobs(jobsList);
    if (rows.length === 0) {
      throw new Error(`recruiterflow: 0 jobs in window.jobsList (${listingUrl})`);
    }

    const companyName =
      source.name.replace(/\s*\([^)]*\)\s*$/, "").trim() || source.company_handle;

    const normalized = await parallelMap(rows, DETAIL_CONCURRENCY, async (row): Promise<NormalizedJob> => {
      const applyUrl = toAbsoluteApplyUrl(row.apply_link);
      let descriptionRaw: string | null = row.details;
      let title = row.job_name;
      let postedAt: number | null = row.last_opened ? parseEpochSeconds(row.last_opened) : null;
      let employment = normalizeEmploymentType(row.employment_type);
      let locationStr: string | null = normalizeLocation(row.details ?? "") ?? null;
      let logo: string | null = null;

      try {
        const pageRes = await fetch(applyUrl, {
          headers: {
            "User-Agent": USER_AGENT,
            Accept: "text/html,application/xhtml+xml,*/*",
          },
          redirect: "follow",
        });
        if (pageRes.ok) {
          const pageHtml = await pageRes.text();
          const ld = parseJobPostingLd(pageHtml);
          if (ld) {
            if (ld.title?.trim()) title = ld.title.trim();
            if (ld.description?.trim()) descriptionRaw = ld.description.trim();
            if (ld.datePosted) {
              const p = parseEpochSeconds(ld.datePosted);
              if (p != null) postedAt = p;
            }
            const et = schemaEmploymentToNormalized(ld.employmentType);
            if (et) employment = et;
            const ldLoc = formatLdLocation(ld);
            if (ldLoc) locationStr = normalizeLocation(ldLoc) ?? ldLoc;
            if (typeof ld.hiringOrganization?.logo === "string" && ld.hiringOrganization.logo.startsWith("http")) {
              logo = ld.hiringOrganization.logo;
            }
          }
        }
      } catch {
        /* keep listing fallbacks */
      }

      if (!locationStr) {
        locationStr =
          normalizeLocation(`${title} ${descriptionRaw ?? ""}`) ??
          normalizeLocation(row.job_name) ??
          null;
      }

      const workplace = normalizeWorkplaceType(row.remote_type, `${descriptionRaw ?? ""} ${title}`);

      const job: NormalizedJob = {
        external_id: String(row.job_id),
        title,
        location: locationStr,
        employment_type: employment,
        workplace_type: workplace,
        apply_url: applyUrl,
        source_url: applyUrl,
        description_raw: descriptionRaw,
        salary_min: null,
        salary_max: null,
        salary_currency: null,
        salary_period: null,
        posted_at: postedAt,
        company_name: companyName,
      };
      if (logo) job.company_logo_url = logo;
      return job;
    });

    return normalized;
  },
};
