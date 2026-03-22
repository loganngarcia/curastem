/**
 * Consider VC job board API fetcher.
 *
 * Consider (consider.com) powers white-label portfolio job boards such as
 * jobs.a16z.com. Listings are loaded via an unauthenticated JSON POST:
 *   POST {origin}/api-boards/search-jobs
 *
 * Two URL shapes:
 *
 * 1) Full portfolio (all companies on that board)
 *    base_url path `/companies` (e.g. https://jobs.a16z.com/companies)
 *    Body: board { id: "<parentId>", isParent: true }, grouped: false
 *    (no parentSlug — same as the SPA company directory)
 *
 * 2) Single portfolio company
 *    base_url path `/jobs/{companySlug}`
 *    Body: board { id: companySlug, isParent: false }, parentSlug: "<parentId>",
 *          grouped: false
 *
 * `grouped: false` returns a flat `jobs` array. Pagination uses `meta.sequence`
 * from the previous response (offset in meta is not reliable).
 *
 * Dedup: do not register two `consider` sources that overlap (e.g. portfolio + per-company).
 * Cross-source dedup skips lower-priority duplicates only; equal priority keeps both rows.
 *
 * Parent board id (e.g. andreessen-horowitz) is read from `window.serverInitialData`
 * on the listing page HTML, with a fallback for known a16z hostnames.
 */

import type { JobSource, NormalizedJob, SalaryPeriod, SourceRow } from "../../types.ts";
import {
  normalizeEmploymentType,
  normalizeLocation,
  normalizeWorkplaceType,
  parseEpochSeconds,
} from "../../utils/normalize.ts";

const HEADERS = {
  "User-Agent": "Curastem-Jobs-Ingestion/1.0 (developers@curastem.org)",
  Accept: "application/json",
  "Content-Type": "application/json",
};

/** Larger pages mean fewer round-trips for ~15k+ portfolio boards. */
const PAGE_SIZE = 500;

/** Parent board id embedded in the SPA shell (same for all pages on that hostname). */
const PARENT_BOARD_BY_HOST: Record<string, string> = {
  "jobs.a16z.com": "andreessen-horowitz",
  "portfoliojobs.a16z.com": "andreessen-horowitz",
};

const PARENT_BOARD_RE = /"board":\{"id":"([^"]+)","isParent":true\}/;

interface ConsiderNormLoc {
  label?: string;
  value?: string;
}

interface ConsiderSalary {
  minValue?: number;
  maxValue?: number;
  currency?: { value?: string };
  period?: { value?: string };
}

interface ConsiderJob {
  jobId: string;
  title: string;
  applyUrl?: string;
  url?: string;
  companyName?: string;
  companySlug?: string;
  companyDomain?: string;
  companyLogos?: { manual?: { src?: string } };
  locations?: string[];
  normalizedLocations?: ConsiderNormLoc[];
  remote?: boolean;
  hybrid?: boolean;
  salary?: ConsiderSalary;
  timeStamp?: string;
  contractor?: boolean;
}

interface ConsiderSearchResponse {
  jobs: ConsiderJob[];
  total?: number;
  meta?: { size?: number; sequence?: string };
}

type ConsiderMode = "parent" | "company";

function parseConsiderBaseUrl(baseUrl: string): {
  origin: string;
  mode: ConsiderMode;
  companySlug?: string;
} {
  let u: URL;
  try {
    u = new URL(baseUrl);
  } catch {
    throw new Error(`consider: invalid base_url ${baseUrl}`);
  }

  const path = u.pathname.replace(/\/$/, "") || "/";
  if (path === "/companies" || path.endsWith("/companies")) {
    return { origin: u.origin, mode: "parent" };
  }

  const parts = u.pathname.split("/").filter(Boolean);
  const ji = parts.indexOf("jobs");
  if (ji >= 0 && parts[ji + 1]) {
    return {
      origin: u.origin,
      mode: "company",
      companySlug: decodeURIComponent(parts[ji + 1]),
    };
  }

  throw new Error(
    `consider: expected base_url ending in /companies (full board) or /jobs/{companySlug}: ${baseUrl}`
  );
}

function extractParentBoardId(html: string, host: string): string {
  const m = html.match(PARENT_BOARD_RE);
  if (m?.[1]) return m[1];
  const fallback = PARENT_BOARD_BY_HOST[host.toLowerCase()];
  if (fallback) return fallback;
  throw new Error(
    `consider: could not determine parent board id (host ${host}). ` +
      "Use jobs.a16z.com or another board whose HTML exposes serverInitialData."
  );
}

function buildLocationString(job: ConsiderJob): string | null {
  const norm = job.normalizedLocations
    ?.map((l) => l.label ?? l.value)
    .filter(Boolean);
  if (norm && norm.length > 0) return norm.join("; ");
  const locs = job.locations?.filter(Boolean);
  if (locs && locs.length > 0) return locs.join("; ");
  return null;
}

function workplaceHint(job: ConsiderJob, locationStr: string | null): string | null {
  if (job.remote) return "remote";
  if (job.hybrid) return "hybrid";
  return locationStr;
}

function salaryPeriod(raw: string | undefined): SalaryPeriod | null {
  if (!raw) return null;
  const v = raw.toLowerCase();
  if (v === "year" || v === "yearly") return "year";
  if (v === "month" || v === "monthly") return "month";
  if (v === "hour" || v === "hourly") return "hour";
  return null;
}

function employmentFromJob(job: ConsiderJob): string | null {
  if (job.contractor) return "contract";
  return null;
}

function companyWebsiteUrl(job: ConsiderJob): string | null {
  if (job.companyDomain) return `https://${job.companyDomain}`;
  if (job.companySlug?.includes(".")) return `https://${job.companySlug}`;
  return null;
}

export const considerFetcher: JobSource = {
  sourceType: "consider",

  async fetch(source: SourceRow): Promise<NormalizedJob[]> {
    const { origin, mode, companySlug } = parseConsiderBaseUrl(source.base_url);

    const pageRes = await fetch(source.base_url.split("?")[0], {
      headers: { ...HEADERS, Accept: "text/html" },
    });
    if (!pageRes.ok) {
      throw new Error(`consider: listing page ${pageRes.status} for ${source.company_handle}`);
    }
    const html = await pageRes.text();
    const parentBoardId = extractParentBoardId(html, new URL(source.base_url).hostname);

    const collected: ConsiderJob[] = [];
    let meta: { size: number; sequence?: string } = { size: PAGE_SIZE };

    for (;;) {
      const body: Record<string, unknown> = {
        meta,
        query: {},
        grouped: false,
      };

      if (mode === "parent") {
        body.board = { id: parentBoardId, isParent: true };
      } else {
        body.board = { id: companySlug!, isParent: false };
        body.parentSlug = parentBoardId;
      }

      const res = await fetch(`${origin}/api-boards/search-jobs`, {
        method: "POST",
        headers: HEADERS,
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        throw new Error(`consider: search-jobs ${res.status} for ${source.company_handle}`);
      }

      const data = (await res.json()) as ConsiderSearchResponse;
      const batch = data.jobs ?? [];
      collected.push(...batch);

      const seq = data.meta?.sequence;
      if (!seq || batch.length === 0) break;
      if (data.total != null && collected.length >= data.total) break;

      meta = { size: PAGE_SIZE, sequence: seq };
    }

    const jobs: NormalizedJob[] = [];
    const defaultCompany =
      source.name.replace(/\s*\(Consider\)\s*/i, "").replace(/\s*\(a16z\)\s*/i, "").trim();

    for (const job of collected) {
      try {
        const locationStr = buildLocationString(job);
        const wp = workplaceHint(job, locationStr);
        const sal = job.salary;

        jobs.push({
          external_id: job.jobId,
          title: job.title?.trim() || "Untitled",
          location: normalizeLocation(locationStr),
          employment_type: normalizeEmploymentType(employmentFromJob(job)),
          workplace_type: normalizeWorkplaceType(wp, locationStr),
          apply_url: job.applyUrl ?? job.url ?? source.base_url,
          source_url: job.url ?? job.applyUrl ?? null,
          description_raw: null,
          salary_min: sal?.minValue ?? null,
          salary_max: sal?.maxValue ?? null,
          salary_currency: sal?.currency?.value ?? null,
          salary_period: salaryPeriod(sal?.period?.value),
          posted_at: parseEpochSeconds(job.timeStamp),
          company_name: job.companyName ?? defaultCompany,
          company_logo_url: job.companyLogos?.manual?.src ?? null,
          company_website_url: companyWebsiteUrl(job),
        });
      } catch {
        continue;
      }
    }

    return jobs;
  },
};
