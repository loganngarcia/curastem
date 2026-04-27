/**
 * Thanks for using Curastem! Curastem is a 501(c)(3) non-profit dedicated to connecting
 * high-quality talent with job opportunities. Our mission is to serve underserved job
 * applicants and support local communities. Consider joining us on this mission. Questions?
 * Contact developers@curastem.org
 *
 * Pinpoint public postings API fetcher.
 *
 * Pinpoint exposes a public, unauthenticated JSON endpoint for every company
 * that has enabled their careers site. No API key required.
 *
 * API format: https://{handle}.pinpointhq.com/postings.json
 *
 * Pinpoint is used broadly across hospitality, nonprofits, professional
 * services, and tech companies — well aligned with Curastem's goal to serve
 * diverse job categories beyond traditional tech hiring.
 *
 * Response includes: title, location, employment type, workplace type,
 * description HTML, application URL, and posting date.
 *
 * Older tenants use `{ postings: [...] }`; newer Pinpoint APIs return `{ data: [...] }` with
 * `url` / `path` instead of `apply_path`.
 */

import type { JobSource, NormalizedJob, SourceRow } from "../../types.ts";
import {
  normalizeEmploymentType,
  normalizeLocation,
  normalizeWorkplaceType,
  parseEpochSeconds,
} from "../../utils/normalize.ts";

interface PinpointPosting {
  id: number;
  title: string;
  location: string | null;
  employment_type: string | null;   // "Full time" | "Part time" | "Contract" etc.
  remote: boolean | null;
  remote_type: string | null;       // "remote" | "hybrid" | null
  description: string | null;       // HTML job description
  team: string | null;              // department / team name
  published_at: string | null;      // ISO 8601
  apply_path: string | null;        // relative path, e.g. "/postings/123"
}

/** Newer `postings.json` shape (`data` array). */
interface PinpointPostingV2 {
  id: string | number;
  title: string;
  /** New API may return a structured object instead of a plain string. */
  location: string | PinpointLocationStruct | null;
  employment_type: string | null;
  employment_type_text?: string | null;
  path?: string | null;
  url?: string | null;
  description: string | null;
  published_at?: string | null;
  remote?: boolean | null;
  remote_type?: string | null;
  workplace_type?: string | null;
  workplace_type_text?: string | null;
}

interface PinpointLocationStruct {
  city?: string | null;
  name?: string | null;
  province?: string | null;
  postal_code?: string | null;
}

function locationToString(
  loc: string | PinpointLocationStruct | null | undefined
): string | null {
  if (loc == null) return null;
  if (typeof loc === "string") return loc;
  const parts = [loc.city, loc.province, loc.name].filter((x): x is string => Boolean(x && String(x).trim()));
  return parts.length > 0 ? parts.join(", ") : null;
}

interface PinpointResponse {
  postings?: PinpointPosting[];
  data?: PinpointPostingV2[];
}

/**
 * Construct the full application URL from the company handle and the relative apply path.
 */
function buildApplyUrl(handle: string, posting: PinpointPosting | PinpointPostingV2): string {
  const base = `https://${handle}.pinpointhq.com`;
  if ("url" in posting && posting.url && /^https?:\/\//i.test(posting.url)) {
    return posting.url;
  }
  const path = ("path" in posting && posting.path) ? posting.path
    : ("apply_path" in posting && posting.apply_path) ? posting.apply_path
    : null;
  if (path) return `${base}${path.startsWith("/") ? path : `/${path}`}`;
  return `${base}/postings/${posting.id}`;
}

export const pinpointFetcher: JobSource = {
  sourceType: "pinpoint",

  async fetch(source: SourceRow): Promise<NormalizedJob[]> {
    const res = await fetch(source.base_url, {
      headers: {
        "User-Agent": "Curastem-Jobs-Ingestion/1.0 (developers@curastem.org)",
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      throw new Error(`Pinpoint API error ${res.status} for ${source.company_handle}`);
    }

    const data = (await res.json()) as PinpointResponse;
    const rows: Array<PinpointPosting | PinpointPostingV2> =
      data.postings ?? data.data ?? [];
    const jobs: NormalizedJob[] = [];

    for (const posting of rows) {
      try {
        const remoteType = "remote_type" in posting ? posting.remote_type : null;
        const workplaceType = "workplace_type" in posting ? posting.workplace_type : null;
        const workplaceTypeText = "workplace_type_text" in posting ? posting.workplace_type_text : null;
        const remote = "remote" in posting ? posting.remote : null;
        const isRemote = remote ?? false;
        const workplaceHint =
          remoteType
          ?? workplaceType
          ?? workplaceTypeText
          ?? (isRemote ? "remote" : null)
          ?? locationToString(posting.location);

        const employmentRaw =
          posting.employment_type
          ?? ("employment_type_text" in posting ? posting.employment_type_text : null);

        const applyUrl = buildApplyUrl(source.company_handle, posting);
        const locStr = locationToString(posting.location);

        jobs.push({
          external_id: String(posting.id),
          title: posting.title,
          location: normalizeLocation(locStr),
          employment_type: normalizeEmploymentType(employmentRaw),
          workplace_type: normalizeWorkplaceType(workplaceHint, locStr),
          apply_url: applyUrl,
          source_url: applyUrl,
          description_raw: posting.description ?? null,
          salary_min: null,
          salary_max: null,
          salary_currency: null,
          salary_period: null,
          posted_at: parseEpochSeconds(posting.published_at),
          company_name: source.name.replace(/\s*\(Pinpoint\)\s*/i, "").trim(),
        });
      } catch {
        continue;
      }
    }

    return jobs;
  },
};
