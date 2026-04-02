/**
 * IBM careers — unified site search API used by www.ibm.com/careers/search (Adobe + embedded search).
 *
 * Public POST https://www-api.ibm.com/search/api/v2 with appId `careers` and scope `careers2`.
 * Same contract as the in-browser Searchkit client; no browser rendering or WAF on this host for
 * typical Worker User-Agent + Origin/Referer headers.
 *
 * `base_url` should be `https://www-api.ibm.com/search/api/v2` (see migrate.ts `br-ibm`).
 */

import type { EmploymentType, JobSource, NormalizedJob, SourceRow } from "../../types.ts";
import { normalizeLocation, normalizeWorkplaceType } from "../../utils/normalize.ts";

const DEFAULT_API = "https://www-api.ibm.com/search/api/v2";
const PAGE_SIZE = 100;
/** Guard when `hits.total` is missing — avoid duplicate pages inflating row counts. */
const MAX_RESULTS = 6000;
const USER_AGENT = "Curastem-Jobs-Ingestion/1.0 (developers@curastem.org)";

const SOURCE_FIELDS = ["title", "url", "body", "country", "dcdate"] as const;

interface IbmSearchHit {
  _source?: {
    title?: string;
    url?: string;
    body?: string;
    country?: string | string[];
    dcdate?: string;
  };
}

interface IbmSearchResponse {
  errors?: Array<{ msg?: string; param?: string }>;
  hits?: {
    total?: { value?: number };
    hits?: IbmSearchHit[];
  };
}

function parseJobId(url: string): string | null {
  try {
    const u = new URL(url);
    const id = u.searchParams.get("jobId");
    return id && /^\d+$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

/** IBM body text often ends with team/level/location, e.g. `… Professional Bangalore, IN`. */
function locationHintFromBody(body: string): string {
  const tail = body.trim().slice(-200);
  const roleTail = tail.match(
    /(?:Professional|Internship|Entry Level|Administration|Technician)\s+(.+)$/i
  );
  if (roleTail?.[1]) return roleTail[1].trim();
  const comma = tail.match(/([A-Za-z][A-Za-z\s\-]+,\s*[A-Z]{2})\s*$/);
  if (comma?.[1]) return comma[1].trim();
  if (/multiple cities/i.test(tail)) return "Multiple Cities";
  return tail;
}

function inferEmployment(body: string): EmploymentType | null {
  if (/\bInternship\b/i.test(body)) return "temporary";
  return null;
}

function postedAtFromDcdate(dcdate: string | undefined): number | null {
  if (!dcdate || !/^\d{4}-\d{2}-\d{2}$/.test(dcdate)) return null;
  const ms = Date.parse(`${dcdate}T12:00:00.000Z`);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

export const ibmCareersFetcher: JobSource = {
  sourceType: "ibm_careers",

  async fetch(source: SourceRow): Promise<NormalizedJob[]> {
    const endpoint = source.base_url?.startsWith("http") ? source.base_url : DEFAULT_API;
    const companyName = source.name.replace(/\s*\([^)]*\)\s*$/, "").trim() || "IBM";

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT,
      Accept: "application/json",
      Origin: "https://www.ibm.com",
      Referer: "https://www.ibm.com/careers/search",
    };

    /** Dedupe by job id — ES pagination can repeat docs when total is misreported. */
    const byId = new Map<string, NormalizedJob>();
    let from = 0;
    let total = Infinity;
    let pages = 0;
    const MAX_PAGES = 55; // ~5500 rows max; aligns with sane Workday-style caps

    while (from < total && byId.size < MAX_RESULTS && pages < MAX_PAGES) {
      pages++;
      const body = {
        appId: "careers",
        scopes: ["careers2"],
        query: { bool: { must: [{ match_all: {} }] } },
        size: PAGE_SIZE,
        from,
        _source: [...SOURCE_FIELDS],
      };

      const res = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(body) });
      const raw = (await res.json()) as IbmSearchResponse;

      if (!res.ok) {
        const msg = raw.errors?.map((e) => e.msg).join("; ") || res.statusText;
        throw new Error(`IBM search API ${res.status}: ${msg}`);
      }
      if (raw.errors?.length) {
        throw new Error(`IBM search API: ${raw.errors.map((e) => e.msg).join("; ")}`);
      }

      const hits = raw.hits?.hits ?? [];
      const n = raw.hits?.total?.value;
      if (typeof n === "number" && Number.isFinite(n) && n > 0) total = n;
      if (hits.length === 0) break;

      for (const h of hits) {
        const s = h._source;
        if (!s?.url || !s.title) continue;
        const jobId = parseJobId(s.url);
        if (!jobId) continue;

        const desc = s.body ?? null;
        const locHint = desc ? locationHintFromBody(desc) : "";
        const workplace = normalizeWorkplaceType(null, desc ?? locHint);

        byId.set(jobId, {
          external_id: jobId,
          title: s.title,
          location: normalizeLocation(locHint || null),
          employment_type: inferEmployment(desc ?? ""),
          workplace_type: workplace,
          apply_url: s.url,
          source_url: s.url,
          description_raw: desc,
          salary_min: null,
          salary_max: null,
          salary_currency: null,
          salary_period: null,
          posted_at: postedAtFromDcdate(s.dcdate),
          company_name: companyName,
        });
      }

      if (hits.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
      if (from >= total) break;
    }

    return [...byId.values()];
  },
};
