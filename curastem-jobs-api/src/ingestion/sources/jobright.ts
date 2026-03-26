/**
 * Jobright (jobright.ai) — roles posted through Jobright's own hiring / TNT product.
 *
 * Public ATS APIs (Greenhouse, etc.) do not list these roles. The site exposes the
 * same payload the web app uses via Next.js data routes:
 *   GET https://jobright.ai/_next/data/{buildId}/jobs/info/{jobId}.json
 *
 * `buildId` rotates with deploys; we scrape it from the homepage HTML. Optionally
 * pin it with query param `jr_build_id` on `base_url` if homepage parsing breaks.
 *
 * `base_url` must be a jobright.ai URL with comma-separated job ids:
 *   https://jobright.ai/?jr_ingest_ids=b2b_xxx,b2b_yyy
 *
 * When `company_handle` is `jobright`, rows whose company name does not match
 * Jobright are skipped (guards against typos in id list).
 *
 * `apply_url` and `source_url` are the public posting page: `pageProps.pageUrl` from the
 * JSON, or `https://jobright.ai/jobs/info/{jobId}` (same page users open to apply).
 */

import type { JobSource, NormalizedJob, SourceRow, WorkplaceType } from "../../types.ts";
import {
  normalizeEmploymentType,
  normalizeLocation,
  normalizeWorkplaceType,
  parseEpochSeconds,
} from "../../utils/normalize.ts";

const USER_AGENT = "Curastem-Jobs-Ingestion/1.0 (developers@curastem.org)";

interface JobrightQualifications {
  mustHave?: string[];
  preferredHave?: string[];
}

interface JobrightJobResult {
  jobId: string;
  jobTitle: string;
  jobLocation?: string;
  isRemote?: boolean;
  workModel?: string;
  publishTime?: string;
  employmentType?: string;
  jobSummary?: string;
  coreResponsibilities?: string[];
  qualifications?: JobrightQualifications;
  minSalary?: number;
  maxSalary?: number;
  userCompanyName?: string;
  jdLogo?: string;
}

interface JobrightCompanyResult {
  companyName?: string;
  companyURL?: string;
}

interface JobrightDataSource {
  jobResult?: JobrightJobResult;
  companyResult?: JobrightCompanyResult;
}

interface JobrightNextDataPage {
  pageProps?: {
    dataSource?: JobrightDataSource;
    pageUrl?: string;
  };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function parseJobrightPostedAt(raw: string | undefined): number | null {
  if (!raw) return null;
  const isoish = raw.includes("T") ? raw : raw.replace(" ", "T");
  return parseEpochSeconds(isoish);
}

function mapWorkplace(jr: JobrightJobResult, location: string | null): WorkplaceType | null {
  if (jr.isRemote) return "remote";
  return normalizeWorkplaceType(jr.workModel ?? null, location);
}

function buildDescriptionHtml(jr: JobrightJobResult): string | null {
  const parts: string[] = [];
  if (jr.jobSummary) parts.push(`<p>${escapeHtml(jr.jobSummary)}</p>`);

  if (jr.coreResponsibilities && jr.coreResponsibilities.length > 0) {
    parts.push("<h3>Responsibilities</h3><ul>");
    for (const line of jr.coreResponsibilities) {
      parts.push(`<li>${escapeHtml(line)}</li>`);
    }
    parts.push("</ul>");
  }

  const q = jr.qualifications;
  if (q?.mustHave && q.mustHave.length > 0) {
    parts.push("<h3>Minimum qualifications</h3><ul>");
    for (const line of q.mustHave) parts.push(`<li>${escapeHtml(line)}</li>`);
    parts.push("</ul>");
  }
  if (q?.preferredHave && q.preferredHave.length > 0) {
    parts.push("<h3>Preferred qualifications</h3><ul>");
    for (const line of q.preferredHave) parts.push(`<li>${escapeHtml(line)}</li>`);
    parts.push("</ul>");
  }

  return parts.length > 0 ? parts.join("\n") : null;
}

async function fetchBuildId(homepageUrl: string): Promise<string> {
  const res = await fetch(homepageUrl, {
    headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
  });
  if (!res.ok) throw new Error(`Jobright: homepage ${res.status}`);
  const html = await res.text();
  const m = html.match(/"buildId":"([^"]+)"/);
  if (!m) throw new Error("Jobright: buildId not found in homepage HTML");
  return m[1];
}

function parseIngestJobIds(baseUrl: string): { origin: string; ids: string[]; pinnedBuildId: string | null } {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error(`Jobright: invalid base_url ${baseUrl}`);
  }
  if (!url.hostname.endsWith("jobright.ai")) {
    throw new Error(`Jobright: base_url must be on jobright.ai, got ${url.hostname}`);
  }
  const raw = url.searchParams.get("jr_ingest_ids") ?? url.searchParams.get("jobIds");
  if (!raw?.trim()) {
    throw new Error(
      "Jobright: base_url must include jr_ingest_ids (comma-separated job ids), e.g. " +
        "https://jobright.ai/?jr_ingest_ids=b2b_xxx,b2b_yyy"
    );
  }
  const ids = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (ids.length === 0) throw new Error("Jobright: jr_ingest_ids is empty");
  const origin = `${url.protocol}//${url.host}`;
  const pinnedBuildId = url.searchParams.get("jr_build_id");
  return { origin, ids, pinnedBuildId };
}

function shouldSkipForHandle(handle: string, companyName: string): boolean {
  if (handle !== "jobright") return false;
  return !/jobright/i.test(companyName);
}

export const jobrightFetcher: JobSource = {
  sourceType: "jobright",

  async fetch(source: SourceRow): Promise<NormalizedJob[]> {
    const { origin, ids, pinnedBuildId } = parseIngestJobIds(source.base_url);
    const buildId = pinnedBuildId ?? (await fetchBuildId(`${origin}/`));

    const out: NormalizedJob[] = [];

    for (const jobId of ids) {
      try {
        const dataUrl = `${origin}/_next/data/${encodeURIComponent(buildId)}/jobs/info/${encodeURIComponent(jobId)}.json`;
        const res = await fetch(dataUrl, {
          headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
        });
        if (!res.ok) continue;

        const payload = (await res.json()) as JobrightNextDataPage;
        const ds = payload.pageProps?.dataSource;
        const jr = ds?.jobResult;
        if (!jr?.jobId || !jr.jobTitle) continue;

        const cr = ds?.companyResult;
        const companyName =
          cr?.companyName?.trim() || jr.userCompanyName?.trim() || "Jobright.ai";

        if (shouldSkipForHandle(source.company_handle, companyName)) continue;

        const locStr = jr.jobLocation ?? null;
        const location = normalizeLocation(locStr);
        const workplace = mapWorkplace(jr, location);

        const pageUrl =
          payload.pageProps?.pageUrl ?? `${origin}/jobs/info/${encodeURIComponent(jr.jobId)}`;

        out.push({
          external_id: jr.jobId,
          title: jr.jobTitle,
          location,
          employment_type: normalizeEmploymentType(jr.employmentType ?? null),
          workplace_type: workplace,
          apply_url: pageUrl,
          source_url: pageUrl,
          description_raw: buildDescriptionHtml(jr),
          salary_min: jr.minSalary ?? null,
          salary_max: jr.maxSalary ?? null,
          salary_currency: jr.minSalary != null || jr.maxSalary != null ? "USD" : null,
          salary_period: jr.minSalary != null || jr.maxSalary != null ? "year" : null,
          posted_at: parseJobrightPostedAt(jr.publishTime),
          company_name: companyName,
          company_logo_url: jr.jdLogo ?? null,
          company_website_url: cr?.companyURL ?? null,
        });
      } catch {
        continue;
      }
    }

    return out;
  },
};
