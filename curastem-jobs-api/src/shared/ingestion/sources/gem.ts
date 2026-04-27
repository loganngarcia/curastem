/**
 * Gem career boards at `https://jobs.gem.com/{vanityPath}` (OATS external postings).
 *
 * The hosted SPA uses Apollo against an unauthenticated endpoint:
 *   POST {origin}/api/public/graphql
 * (`JobBoardList` + `ExternalJobPostingQuery` — same operations as the public site.)
 *
 * `base_url` is the board root, e.g. `https://jobs.gem.com/productboard`, or any job URL
 * under that board (normalized to the first path segment after the host).
 */

import type {
  EmploymentType,
  JobSource,
  NormalizedJob,
  SourceRow,
  WorkplaceType,
} from "../../types.ts";
import {
  htmlToText,
  normalizeEmploymentType,
  normalizeLocation,
  normalizeWorkplaceType,
  parseEpochSeconds,
} from "../../utils/normalize.ts";

const USER_AGENT = "Curastem-Jobs-Ingestion/1.0 (developers@curastem.org)";
const DETAIL_CONCURRENCY = 8;

const LIST_QUERY = `
query JobBoardList($boardId: String!) {
  oatsExternalJobPostings(boardId: $boardId) {
    jobPostings {
      extId
      title
      locations {
        name
        city
        isoCountry
        isRemote
      }
      job {
        employmentType
        locationType
      }
    }
  }
}`;

const DETAIL_QUERY = `
query ExternalJobPostingQuery($boardId: String!, $extId: String!) {
  oatsExternalJobPosting(boardId: $boardId, extId: $extId) {
    title
    descriptionHtml
    extId
    firstPublishedTsSec
    locations {
      name
      city
      isoCountry
      isRemote
    }
    job {
      employmentType
      locationType
      teamDisplayName
    }
  }
}`;

interface GemLocation {
  name?: string;
  city?: string;
  isoCountry?: string;
  isRemote?: boolean;
}

interface GemListJob {
  extId: string;
  title: string;
  locations?: GemLocation[];
  job?: { employmentType?: string; locationType?: string };
}

interface GemDetailJob {
  title?: string;
  descriptionHtml?: string | null;
  extId?: string;
  firstPublishedTsSec?: number | null;
  locations?: GemLocation[];
  job?: { employmentType?: string; locationType?: string; teamDisplayName?: string };
}

function parseGemBoard(input: string): { origin: string; boardId: string } {
  const u = new URL(input.trim());
  if (u.hostname !== "jobs.gem.com") {
    throw new Error(`gem: base_url must use host jobs.gem.com, got ${input}`);
  }
  const parts = u.pathname.replace(/\/$/, "").split("/").filter(Boolean);
  if (parts.length === 0) {
    throw new Error(`gem: missing board vanity path in ${input}`);
  }
  return { origin: u.origin, boardId: parts[0]! };
}

async function gemGraphql<T>(
  origin: string,
  operationName: string,
  query: string,
  variables: Record<string, unknown>
): Promise<T> {
  const res = await fetch(`${origin}/api/public/graphql`, {
    method: "POST",
    headers: {
      "User-Agent": USER_AGENT,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ operationName, query, variables }),
  });
  if (!res.ok) {
    throw new Error(`gem: GraphQL HTTP ${res.status} (${operationName})`);
  }
  const json = (await res.json()) as { data?: T; errors?: Array<{ message?: string }> };
  if (json.errors?.length) {
    throw new Error(`gem GraphQL: ${json.errors[0]?.message ?? "unknown"}`);
  }
  if (json.data === undefined) {
    throw new Error(`gem GraphQL: missing data (${operationName})`);
  }
  return json.data;
}

function gemEmployment(raw: string | null | undefined): EmploymentType | null {
  if (!raw) return null;
  const u = raw.toUpperCase().replace(/-/g, "_");
  const asUnderscore = u.toLowerCase();
  if (asUnderscore === "full_time") return normalizeEmploymentType("full_time");
  if (asUnderscore === "part_time") return normalizeEmploymentType("part_time");
  if (asUnderscore === "contract") return normalizeEmploymentType("contract");
  if (asUnderscore === "temporary") return normalizeEmploymentType("temporary");
  if (asUnderscore === "intern" || asUnderscore === "internship") return null;
  return normalizeEmploymentType(raw);
}

function gemWorkplace(locationType: string | null | undefined, locationStr: string): WorkplaceType | null {
  if (!locationType) return normalizeWorkplaceType(null, locationStr);
  const lt = locationType.toUpperCase().replace(/-/g, "_");
  if (lt === "REMOTE") return "remote";
  if (lt === "HYBRID") return "hybrid";
  if (lt === "ONSITE" || lt === "ON_SITE") return "on_site";
  return normalizeWorkplaceType(locationType, locationStr);
}

function locationsToString(locs: GemLocation[] | null | undefined): string | null {
  if (!locs?.length) return null;
  const parts = locs.map((l) => {
    const city = l.city?.trim();
    const name = l.name?.trim();
    const cc = l.isoCountry?.trim();
    const base = city || name || "";
    if (base && cc) return `${base}, ${cc}`;
    return base || name || cc || "";
  }).filter(Boolean);
  if (parts.length === 0) return null;
  return parts.join("; ");
}

async function parallelMap<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]!, i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

export const gemFetcher: JobSource = {
  sourceType: "gem",

  async fetch(source: SourceRow): Promise<NormalizedJob[]> {
    const { origin, boardId } = parseGemBoard(source.base_url);
    const listData = await gemGraphql<{
      oatsExternalJobPostings: { jobPostings: GemListJob[] } | null;
    }>(origin, "JobBoardList", LIST_QUERY, { boardId });

    const briefs = listData.oatsExternalJobPostings?.jobPostings ?? [];
    if (briefs.length === 0) {
      throw new Error(`gem: 0 job postings for board ${boardId}`);
    }

    const fromSource = source.name.replace(/\s*\(Gem\)\s*/i, "").trim();

    const rows = await parallelMap(briefs, DETAIL_CONCURRENCY, async (brief) => {
      const extId = brief.extId?.trim();
      if (!extId) return null;

      let detail: GemDetailJob | null = null;
      try {
        const d = await gemGraphql<{ oatsExternalJobPosting: GemDetailJob | null }>(
          origin,
          "ExternalJobPostingQuery",
          DETAIL_QUERY,
          { boardId, extId }
        );
        detail = d.oatsExternalJobPosting;
      } catch {
        detail = null;
      }

      const title = (detail?.title ?? brief.title)?.trim();
      if (!title) return null;

      const locStr = normalizeLocation(locationsToString(detail?.locations ?? brief.locations));

      const emp = gemEmployment(detail?.job?.employmentType ?? brief.job?.employmentType ?? null);
      const workplace = gemWorkplace(
        detail?.job?.locationType ?? brief.job?.locationType ?? null,
        locStr || ""
      );

      const descriptionRaw = detail?.descriptionHtml
        ? htmlToText(detail.descriptionHtml).trim() || null
        : null;

      const postedAt =
        detail?.firstPublishedTsSec != null ? parseEpochSeconds(detail.firstPublishedTsSec) : null;

      const pathJob = `${encodeURIComponent(boardId)}/${encodeURIComponent(extId)}`;
      const canonicalUrl = `${origin}/${pathJob}`;

      const row: NormalizedJob = {
        external_id: extId,
        title,
        location: locStr,
        employment_type: emp,
        workplace_type: workplace,
        apply_url: canonicalUrl,
        source_url: canonicalUrl,
        description_raw: descriptionRaw,
        salary_min: null,
        salary_max: null,
        salary_currency: null,
        salary_period: null,
        posted_at: postedAt,
        company_name: fromSource || "Unknown",
        company_logo_url: null,
        company_website_url: null,
      };
      return row;
    });

    const ok = rows.filter((j): j is NormalizedJob => j !== null);
    if (ok.length === 0) {
      throw new Error(`gem: ${briefs.length} listing(s) but 0 normalized jobs (${boardId})`);
    }
    return ok;
  },
};
