/**
 * Y Combinator (workatastartup.com) job board fetcher.
 *
 * workatastartup.com is built with Inertia.js + Rails. Page data is embedded
 * in the server-rendered HTML via a `data-page` attribute as HTML-entity-encoded
 * JSON. By sending an `X-Inertia: true` request header, the server skips HTML
 * rendering and responds with the raw JSON page props directly.
 *
 * Stability: ★★★☆☆ Moderate
 *   - Relies on an undocumented Inertia version protocol (hash changes per deploy)
 *   - Each of 10 role categories exposes up to 30 unauthenticated jobs ≈ 230 unique
 *   - YC has strong incentive to keep the public listing accessible for applicants
 *   - Full job description text is gated behind login; AI enrichment uses a synthetic summary
 *
 * Public access method (no auth required):
 *   GET https://www.workatastartup.com/jobs/l/{role}
 *   Header: X-Inertia: true
 *   Header: X-Inertia-Version: {version_hash}
 *
 * The version hash is extracted dynamically from the homepage HTML on each run.
 * Company logos are included in the API response and are written to the companies
 * table — particularly valuable for small YC startups with no other logo source.
 */

import type { JobSource, NormalizedJob, SourceRow } from "../../types.ts";
import { normalizeEmploymentType, normalizeLocation, normalizeWorkplaceType } from "../../utils/normalize.ts";

/** Shape of the Inertia.js data-page JSON embedded in the homepage HTML */
interface InertiaPageData {
  version: string;
  props: {
    jobs?: YCJob[];
  };
}

/** Single job record returned by the workatastartup.com Inertia API */
interface YCJob {
  id: number;
  title: string;
  /** Raw employment type string, e.g. "fulltime", "parttime", "contractor" */
  jobType: string;
  location: string | null;
  /** Broad role category, e.g. "Backend", "Design", "Sales" */
  roleType: string | null;
  companyName: string;
  companySlug: string;
  /** YC batch identifier, e.g. "W25", "S24" */
  companyBatch: string | null;
  /** One-line company description provided by the founder */
  companyOneLiner: string | null;
  /** CDN-hosted company logo URL — present for all YC companies */
  companyLogoUrl: string | null;
  /** Application URL — requires a YC account to complete the application */
  applyUrl: string;
}

/**
 * All publicly accessible role category paths.
 * Each path returns up to 30 jobs; combined and deduplicated ≈ 230 unique jobs.
 */
const ROLE_PATHS = [
  "/jobs/l/software-engineer",
  "/jobs/l/designer",
  "/jobs/l/recruiting",
  "/jobs/l/science",
  "/jobs/l/product-manager",
  "/jobs/l/operations",
  "/jobs/l/sales-manager",
  "/jobs/l/marketing",
  "/jobs/l/legal",
  "/jobs/l/finance",
] as const;

const BASE_URL = "https://www.workatastartup.com";
const USER_AGENT = "Curastem-Jobs-Ingestion/1.0 (developers@curastem.org)";

/**
 * Fetches the Inertia version hash from the homepage HTML.
 * The hash is embedded in the `data-page` attribute and changes on every YC code deploy.
 * Fetching it dynamically on each run makes the fetcher self-healing.
 */
async function fetchInertiaVersion(): Promise<string> {
  const res = await fetch(`${BASE_URL}/jobs`, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html",
    },
  });

  if (!res.ok) {
    throw new Error(`YC homepage request failed HTTP ${res.status}`);
  }

  const html = await res.text();

  // data-page value is HTML-entity-encoded JSON
  const match = html.match(/data-page="([^"]+)"/);
  if (!match) {
    throw new Error("YC page missing data-page attribute — Inertia framework may have been updated");
  }

  // Decode HTML entities (&quot; → ", &amp; → &, &#39; → ')
  const decoded = match[1]
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'");

  const pageData = JSON.parse(decoded) as InertiaPageData;

  if (!pageData.version) {
    throw new Error("YC Inertia version hash is empty");
  }

  return pageData.version;
}

/**
 * Fetches jobs for a single role category path using the Inertia XHR protocol.
 * The X-Inertia header causes the server to return JSON props instead of full HTML.
 * A 409 response means the version hash is stale; return empty rather than crashing.
 */
async function fetchRoleJobs(rolePath: string, version: string): Promise<YCJob[]> {
  const res = await fetch(`${BASE_URL}${rolePath}`, {
    headers: {
      "User-Agent": USER_AGENT,
      "Accept": "application/json",
      "X-Requested-With": "XMLHttpRequest",
      "X-Inertia": "true",
      "X-Inertia-Version": version,
    },
  });

  // 409 = version mismatch; Inertia expects a full page reload. Skip this category.
  if (res.status === 409) {
    return [];
  }

  if (!res.ok) {
    throw new Error(`YC role path ${rolePath} request failed HTTP ${res.status}`);
  }

  const data = (await res.json()) as InertiaPageData;
  return data.props?.jobs ?? [];
}

/**
 * Maps YC's raw jobType string to the Curastem standard EmploymentType.
 */
function mapJobType(jobType: string): string | null {
  switch (jobType.toLowerCase()) {
    case "fulltime":   return "full_time";
    case "parttime":   return "part_time";
    case "contractor": return "contract";
    case "internship": return "internship";
    default:           return null;
  }
}

/**
 * Builds a synthetic description_raw for YC jobs that lack full description text.
 * The public Inertia API only returns metadata fields (title, company, location, etc.).
 * This synthetic text gives Gemini's lazy AI enrichment enough context to generate
 * a useful job_summary and structured job_description on the detail endpoint.
 */
function buildSyntheticDescription(job: YCJob): string {
  const lines: string[] = [];

  lines.push(`Company: ${job.companyName}${job.companyBatch ? ` (YC ${job.companyBatch})` : ""}`);

  if (job.companyOneLiner) {
    lines.push(`About: ${job.companyOneLiner}`);
  }

  lines.push(`Role: ${job.title}`);

  if (job.roleType) {
    lines.push(`Function: ${job.roleType}`);
  }

  if (job.location) {
    lines.push(`Location: ${job.location}`);
  }

  if (job.jobType) {
    lines.push(`Employment: ${job.jobType}`);
  }

  lines.push(`\nThis position is listed on the Y Combinator job board (workatastartup.com). Y Combinator is the world's leading startup accelerator. Applicants can apply directly through the YC platform.`);

  return lines.join("\n");
}

export const ycombinatorFetcher: JobSource = {
  sourceType: "ycombinator",

  async fetch(_source: SourceRow): Promise<NormalizedJob[]> {
    // Fetch the Inertia version hash dynamically — it changes with every YC code deploy
    const version = await fetchInertiaVersion();

    // Fire all 10 role category requests in parallel to minimize wall-clock time.
    // Promise.allSettled ensures a single failing category never blocks the rest.
    const roleResults = await Promise.allSettled(
      ROLE_PATHS.map((path) => fetchRoleJobs(path, version))
    );

    // Merge all categories and deduplicate by job ID (a job can appear in multiple categories)
    const seenIds = new Set<number>();
    const allJobs: YCJob[] = [];

    for (const result of roleResults) {
      if (result.status === "rejected") {
        // Single category failure does not block others
        continue;
      }
      for (const job of result.value) {
        if (!seenIds.has(job.id)) {
          seenIds.add(job.id);
          allJobs.push(job);
        }
      }
    }

    const normalized: NormalizedJob[] = [];

    for (const job of allJobs) {
      try {
        const locationStr = job.location ?? "";
        normalized.push({
          external_id: String(job.id),
          title: job.title,
          location: normalizeLocation(locationStr),
          employment_type: normalizeEmploymentType(mapJobType(job.jobType)),
          workplace_type: normalizeWorkplaceType(null, locationStr),
          apply_url: job.applyUrl,
          source_url: `${BASE_URL}/jobs/${job.id}`,
          // The public API does not include full job description text;
          // build a synthetic summary so Gemini AI enrichment has context to work with.
          description_raw: buildSyntheticDescription(job),
          salary_min: null,
          salary_max: null,
          salary_currency: null,
          salary_period: null,
          posted_at: null,
          // Each YC job belongs to a different company; use the job's own companyName.
          company_name: job.companyName,
          // YC provides CDN-hosted logos for all companies — valuable for small startups
          // that won't have logos populated from any other ingestion source.
          company_logo_url: job.companyLogoUrl ?? null,
        });
      } catch {
        // Skip individually malformed job records without aborting the entire fetch
        continue;
      }
    }

    return normalized;
  },
};
