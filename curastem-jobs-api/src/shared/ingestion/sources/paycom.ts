/**
 * Paycom Online ATS career portals.
 *
 * Boards are served from:
 * `https://www.paycomonline.net/v4/ats/web.php/portal/{portalKey}/career-page`
 * The shell HTML embeds `configsFromHost.sessionJWT`, sent as `Authorization` to
 * `https://portal-applicant-tracking.{region}.paycomonline.net` (host is taken from the same page).
 *
 * Listing: `POST /api/ats/job-posting-previews/search` with `skip`, `take`, and `filtersForQuery`
 * (see Paycom Sprawl `SIr` — distanceFrom, positionTypes, keywordSearchText, sortOption, etc.).
 * Detail (full HTML description): `GET /api/ats/job-postings/{jobId}`.
 *
 * `base_url` may be the career-page URL or a single job URL under the same portal; it is
 * normalized to `.../career-page` for session bootstrap.
 */

import type { EmploymentType, JobSource, NormalizedJob, SourceRow } from "../../types.ts";
import {
  extractSalaryFromText,
  htmlToText,
  normalizeEmploymentType,
  normalizeLocation,
  normalizeWorkplaceType,
  parseEpochSeconds,
} from "../../utils/normalize.ts";

const USER_AGENT = "Curastem-Jobs-Ingestion/1.0 (developers@curastem.org)";
const DETAIL_FETCH_CONCURRENCY = 10;
const PAGE_SIZE = 100;
const DEFAULT_API_ORIGIN = "https://portal-applicant-tracking.us-cent.paycomonline.net";

const PORTAL_KEY_RE = /\/portal\/([0-9a-f]{32})\//i;

interface PaycomPreview {
  jobId: number;
  jobTitle: string | null;
  positionType?: string;
  remoteType?: string;
  locations?: string | null;
}

interface PaycomJobPosting {
  jobId?: number;
  jobTitle?: string | null;
  location?: string | null;
  city?: string | null;
  remoteType?: string | null;
  positionType?: string | null;
  description?: string | null;
  qualifications?: string | null;
  salaryRange?: string | null;
  googleJobJson?: string | null;
}

function careerPageUrl(rawBase: string): string {
  const trimmed = rawBase.trim();
  const url = new URL(trimmed);
  const keyMatch = url.pathname.match(PORTAL_KEY_RE);
  if (!keyMatch) {
    throw new Error(`Paycom base_url must include /portal/{32-char-hex}/… (${trimmed})`);
  }
  const key = keyMatch[1];
  return `https://www.paycomonline.net/v4/ats/web.php/portal/${key}/career-page`;
}

function portalJobUrl(portalKey: string, jobId: number): string {
  return `https://www.paycomonline.net/v4/ats/web.php/portal/${portalKey}/jobs/${jobId}`;
}

function extractPortalKey(urlish: string): string | null {
  return urlish.match(PORTAL_KEY_RE)?.[1] ?? null;
}

function extractApiOrigin(html: string): string {
  const m = html.match(/portal-applicant-tracking\.[a-z0-9.-]+/i);
  if (m) return `https://${m[0]}`;
  return DEFAULT_API_ORIGIN;
}

function extractSessionJwt(html: string): string | null {
  const m = html.match(/"sessionJWT":"([^"]+)"/);
  return m?.[1] ?? null;
}

function authHeaders(jwt: string, careerPage: string): Record<string, string> {
  return {
    "User-Agent": USER_AGENT,
    Accept: "application/json",
    Authorization: jwt,
    Locale: "en-US",
    origin: "https://www.paycomonline.net",
    referer: careerPage,
  };
}

function searchBody(skip: number, take: number) {
  return {
    skip,
    take,
    filtersForQuery: {
      distanceFrom: 0,
      workEnvironments: [] as string[],
      positionTypes: [] as string[],
      educationLevels: [] as string[],
      categories: [] as string[],
      travelTypes: [] as string[],
      shiftTypes: [] as string[],
      otherFilters: [] as string[],
      keywordSearchText: "",
      location: "",
      sortOption: "",
    },
  };
}

function inferEmploymentFromText(raw: string): EmploymentType | null {
  const text = raw.toLowerCase();
  if (text.includes("part time") || text.includes("part-time") || text.includes("parttime")) return "part_time";
  if (text.includes("contract")) return "contract";
  if (text.includes("temporary") || /\btemp\b/.test(text)) return "temporary";
  if (text.includes("volunteer")) return "volunteer";
  if (text.includes("full time") || text.includes("full-time") || text.includes("fulltime")) return "full_time";
  return null;
}

function employmentFromPaycom(
  positionType: string | null | undefined,
  title: string,
  description: string,
): EmploymentType | null {
  const pt = positionType?.toLowerCase() ?? "";
  if (pt.includes("full") && pt.includes("part")) {
    const blob = `${title}\n${description}`.toLowerCase();
    const p = blob.includes("part-time") || blob.includes("part time");
    const f = blob.includes("full-time") || blob.includes("full time");
    if (p && !f) return "part_time";
    if (f && !p) return "full_time";
    return null;
  }
  return normalizeEmploymentType(positionType ?? null) ?? inferEmploymentFromText(`${positionType ?? ""}\n${title}\n${description}`);
}

function descriptionFromPosting(posting: PaycomJobPosting): string | null {
  const chunks = [posting.description, posting.qualifications]
    .filter(Boolean)
    .map((h) => htmlToText(String(h).trim()));
  const text = chunks.join("\n\n").trim();
  return text || null;
}

function postedAtFromPosting(posting: PaycomJobPosting): number | null {
  const raw = posting.googleJobJson;
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as { datePosted?: string };
    return parseEpochSeconds(o.datePosted ?? null);
  } catch {
    return null;
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += limit) {
    const chunk = items.slice(i, i + limit);
    out.push(...(await Promise.all(chunk.map((item) => fn(item)))));
  }
  return out;
}

export const paycomFetcher: JobSource = {
  sourceType: "paycom",

  async fetch(source: SourceRow): Promise<NormalizedJob[]> {
    const companyName = source.name.replace(/\s*\([^)]*paycom[^)]*\)\s*/i, "").trim();
    const careerPage = careerPageUrl(source.base_url);
    const portalKey = extractPortalKey(careerPage);
    if (!portalKey) throw new Error(`Paycom portal key missing for ${source.company_handle}`);

    const shellRes = await fetch(careerPage, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
    });
    if (!shellRes.ok) {
      throw new Error(`Paycom career page fetch failed (${shellRes.status}) for ${source.company_handle}`);
    }
    const html = await shellRes.text();
    const jwt = extractSessionJwt(html);
    if (!jwt) {
      throw new Error(`Paycom sessionJWT not found for ${source.company_handle}`);
    }
    const apiOrigin = extractApiOrigin(html);
    const jsonHeaders = {
      ...authHeaders(jwt, careerPage),
      "Content-Type": "application/json",
    };

    const searchUrl = `${apiOrigin}/api/ats/job-posting-previews/search`;
    const firstRes = await fetch(searchUrl, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify(searchBody(0, PAGE_SIZE)),
    });
    if (!firstRes.ok) {
      throw new Error(`Paycom search failed (${firstRes.status}) for ${source.company_handle}`);
    }
    const firstJson = (await firstRes.json()) as {
      jobPostingPreviews?: PaycomPreview[];
      jobPostingPreviewsCount?: number;
    };
    const total = firstJson.jobPostingPreviewsCount ?? 0;
    const previews: PaycomPreview[] = [...(firstJson.jobPostingPreviews ?? [])];

    for (let skip = previews.length; skip < total; skip += PAGE_SIZE) {
      const res = await fetch(searchUrl, {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify(searchBody(skip, PAGE_SIZE)),
      });
      if (!res.ok) {
        throw new Error(`Paycom search page failed (${res.status}) at skip=${skip}`);
      }
      const j = (await res.json()) as { jobPostingPreviews?: PaycomPreview[] };
      previews.push(...(j.jobPostingPreviews ?? []));
    }

    if (previews.length === 0) return [];

    const details = await mapWithConcurrency(previews, DETAIL_FETCH_CONCURRENCY, async (preview) => {
      const detailUrl = `${apiOrigin}/api/ats/job-postings/${preview.jobId}`;
      const res = await fetch(detailUrl, {
        headers: authHeaders(jwt, careerPage),
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { jobPosting?: PaycomJobPosting };
      const posting = body.jobPosting;
      if (!posting) return null;
      if (!posting.jobTitle && !preview.jobTitle) return null;
      return { preview, posting };
    });

    const jobs: NormalizedJob[] = [];
    for (const row of details) {
      if (!row) continue;
      const { preview, posting } = row;
      const title = (posting.jobTitle ?? preview.jobTitle ?? "").trim();
      if (!title) continue;

      const locationRaw = posting.location ?? preview.locations ?? posting.city ?? null;
      const location = normalizeLocation(locationRaw, source.company_handle);

      const descriptionRaw = descriptionFromPosting(posting);
      const salaryText = posting.salaryRange?.trim() || null;
      const salary = salaryText ? extractSalaryFromText(salaryText) : null;
      const postedAt = postedAtFromPosting(posting);
      const positionType = posting.positionType ?? preview.positionType;
      const remoteRaw = posting.remoteType ?? preview.remoteType;

      const jobPageUrl = portalJobUrl(portalKey, preview.jobId);

      jobs.push({
        external_id: String(preview.jobId),
        title,
        location,
        employment_type: employmentFromPaycom(positionType, title, descriptionRaw ?? ""),
        workplace_type: normalizeWorkplaceType(remoteRaw, location),
        apply_url: jobPageUrl,
        source_url: jobPageUrl,
        description_raw: descriptionRaw,
        salary_min: salary ? salary.min : null,
        salary_max: salary ? salary.max : null,
        salary_currency: salary ? salary.currency : null,
        salary_period: salary ? salary.period : null,
        posted_at: postedAt,
        company_name: companyName,
      });
    }

    return jobs;
  },
};
