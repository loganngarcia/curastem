/**
 * K12JobSpot (Frontline / Teachers-Teachers) — **plain `fetch` only** (no browser).
 *
 * The Nuxt app calls `POST https://api.k12jobspot.com/api/Jobs/Search` with the same body the
 * Opportunities UI builds: `searchPhrase`, optional `location` (geocoded model) **or** state
 * search (`locality` + `location: null` + `filters` with `stateFilter`), and **pagination via
 * `pageStartIndex` / `pageEndIndex`** (1-based indices, *not* `skip` / `take`).
 *
 * `base_url` should be a K12 search URL. Supported query parameters:
 * - **`state`** (required) — two-letter US state code, e.g. `CA` (drives `stateFilter` server-side)
 * - **`keywords`** (optional) — `searchPhrase`
 * - **`locality`** (optional) — display string for state mode (default: full state name from `state`)
 *
 * List responses are capped (often `totalResultsCount` ≤ 2000). Full posting text is loaded from
 * `GET /api/Jobs/{id}` → `paragraphs[].content` (HTML), same as the job detail page.
 *
 * CORS: the list `POST` must send `Origin: https://www.k12jobspot.com` and a `Referer` on the
 * `www.k12jobspot.com` origin or the API returns 404.
 */

import { batchGetExistingJobs } from "../../db/queries.ts";
import type { Env, JobSource, NormalizedJob, SourceRow } from "../../types.ts";
import {
  htmlToText,
  normalizeEmploymentType,
  normalizeLocation,
  normalizeWorkplaceType,
} from "../../utils/normalize.ts";

const USER_AGENT = "Curastem-Jobs-Ingestion/1.0 (developers@curastem.org)";

const API_ORIGIN = "https://api.k12jobspot.com";
const WEB_ORIGIN = "https://www.k12jobspot.com";

const MAX_JOBS_PER_RUN = 2000;
const MAX_DETAIL_JOBS = 400;
const DETAIL_FETCH_CONCURRENCY = 16;
const PAGE_SIZE = 100;

const K12_FOOTER = "Listing source: K12JobSpot (K–12 education job board, Frontline).";

interface LocationBlock {
  city?: string | null;
  regionCode?: string | null;
  address?: string | null;
  postalCode?: string | null;
  isRemote?: boolean | null;
  name?: string | null;
}

interface K12Paragraph {
  id?: number;
  title?: string | null;
  content?: string | null;
}

interface K12ListJob {
  id: number;
  guid?: string;
  title?: string | null;
  hiringOrganization?: string | null;
  postedDate?: string | null;
  jobLocation?: LocationBlock[] | null;
  location?: LocationBlock | null;
}

interface SearchResponse {
  jobs?: K12ListJob[] | null;
  totalResultsCount?: number;
}

function stateCodeToLocalityName(code: string): string {
  const c = code.trim().toUpperCase();
  if (c.length !== 2) return c;
  try {
    const name = new Intl.DisplayNames("en", { type: "region" }).of(`US-${c}`);
    return (name && name !== c ? name : c) as string;
  } catch {
    return c;
  }
}

function listHeadersJson(): Record<string, string> {
  return {
    "User-Agent": USER_AGENT,
    Accept: "application/json",
    "Content-Type": "application/json",
    Origin: WEB_ORIGIN,
    Referer: `${WEB_ORIGIN}/Search/Opportunities`,
  };
}

function detailHeaders(): Record<string, string> {
  return {
    "User-Agent": USER_AGENT,
    Accept: "application/json",
  };
}

function buildPublicJobUrl(jobId: number): string {
  return `${WEB_ORIGIN}/Job/${jobId}`;
}

function formatLocationFromListJob(j: K12ListJob): string {
  const jl0 = j.jobLocation?.[0];
  const a = jl0?.city && jl0?.regionCode
    ? `${jl0.city}, ${jl0.regionCode}`
    : j.location?.city && j.location?.regionCode
      ? `${j.location.city}, ${j.location.regionCode}`
      : "";
  if (a.trim()) return a.trim();
  return "United States";
}

function hasStashedRealDescription(footer: string, d: string | null | undefined): boolean {
  if (!d || !d.trim()) return false;
  if (d.includes(footer)) return false;
  return d.trim().length >= 40;
}

function textFromParagraphs(raw: K12Paragraph[] | null | undefined): string | null {
  if (!raw || !Array.isArray(raw) || raw.length === 0) return null;
  const parts: string[] = [];
  for (const p of raw) {
    const html = (p.content ?? "").trim();
    if (!html) continue;
    const t = htmlToText(html);
    if (p.title && String(p.title).trim()) {
      parts.push(String(p.title).trim() + "\n" + t);
    } else {
      parts.push(t);
    }
  }
  const joined = parts.join("\n\n").trim();
  return joined.length > 0 ? joined : null;
}

function buildSynthetic(employer: string, title: string, loc: string): string {
  const lines: string[] = [];
  const org = (employer || "School or district").trim();
  lines.push(`Organization: ${org}`);
  lines.push(`Role: ${(title || "").trim()}`);
  if (loc.trim()) lines.push(`Location: ${loc.trim()}`);
  lines.push(K12_FOOTER);
  return lines.join("\n");
}

function parseDateSec(raw: string | null | undefined, fallback: number): number {
  if (!raw) return fallback;
  const ms = Date.parse(raw);
  if (Number.isNaN(ms)) return fallback;
  return Math.floor(ms / 1000);
}

export interface K12JobspotQuery {
  state: string;
  searchPhrase: string;
  /** Display locality string for the state search (default: full state name). */
  localityLabel: string;
}

function parseBaseUrlToQuery(baseUrl: string): K12JobspotQuery {
  const u = new URL(baseUrl);
  const sp = u.searchParams;
  const st = (sp.get("state") || sp.get("stateFilterValue") || "").trim().toUpperCase();
  if (st.length !== 2) {
    throw new Error("k12jobspot: base_url must include ?state=XX (two-letter US state), e.g. &state=CA");
  }
  const localityOverride = (sp.get("locality") || "").trim();
  return {
    state: st,
    searchPhrase: (sp.get("keywords") || sp.get("q") || "").trim(),
    localityLabel: localityOverride || stateCodeToLocalityName(st),
  };
}

function buildStateSearchBody(
  q: K12JobspotQuery,
  pageStartIndex: number,
  pageEndIndex: number
): Record<string, unknown> {
  return {
    searchPhrase: q.searchPhrase,
    locality: q.localityLabel,
    location: null,
    pageStartIndex,
    pageEndIndex,
    filters: [
      {
        name: "stateFilter",
        filters: [{ name: q.state }],
      },
    ],
  };
}

async function postSearch(body: unknown): Promise<SearchResponse> {
  const res = await fetch(`${API_ORIGIN}/api/Jobs/Search`, {
    method: "POST",
    headers: listHeadersJson(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`K12JobSpot Search ${res.status}`);
  }
  return (await res.json()) as SearchResponse;
}

async function fetchJobDetailJson(jobId: number): Promise<Record<string, unknown> | null> {
  const res = await fetch(`${API_ORIGIN}/api/Jobs/${jobId}`, { headers: detailHeaders() });
  if (!res.ok) return null;
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += limit) {
    const chunk = items.slice(i, i + limit);
    out.push(...(await Promise.all(chunk.map((x) => fn(x)))));
  }
  return out;
}

interface Stub {
  row: K12ListJob;
  applyFallback: string;
  synthetic: string;
}

export const k12jobspotFetcher: JobSource = {
  sourceType: "k12jobspot",

  async fetch(source: SourceRow, env?: Env): Promise<NormalizedJob[]> {
    const q = parseBaseUrlToQuery(source.base_url);
    const nowSec = Math.floor(Date.now() / 1000);
    const stubs: Stub[] = [];
    let pageStart = 1;
    let totalCap = Number.POSITIVE_INFINITY;
    const pageSize = PAGE_SIZE;

    while (stubs.length < MAX_JOBS_PER_RUN) {
      const pageEnd = pageStart + pageSize - 1;
      const data = await postSearch(buildStateSearchBody(q, pageStart, pageEnd));
      const list = data.jobs ?? [];
      if (typeof data.totalResultsCount === "number" && data.totalResultsCount >= 0) {
        totalCap = data.totalResultsCount;
      }
      if (list.length === 0) break;

      for (const row of list) {
        if (stubs.length >= MAX_JOBS_PER_RUN) break;
        const title = (row.title ?? "").trim();
        if (!title || !row.id) continue;
        const loc = formatLocationFromListJob(row);
        const companyName = (row.hiringOrganization ?? "School or district").trim();
        const applyFallback = buildPublicJobUrl(row.id);
        const synthetic = buildSynthetic(companyName, title, loc);
        stubs.push({ row, applyFallback, synthetic });
      }

      if (list.length < pageSize) break;
      pageStart = pageEnd + 1;
      if (pageStart > totalCap) break;
    }

    const toEnrich = stubs.slice(0, MAX_DETAIL_JOBS);
    const externalIds = toEnrich.map((s) => String(s.row.id));
    const existingByEid =
      env?.JOBS_DB && externalIds.length > 0
        ? await batchGetExistingJobs(env.JOBS_DB, source.id, externalIds)
        : new Map();

    const fromDetail: Array<{ desc: string | null; applyUrl: string } | null> = Array.from(
      { length: toEnrich.length },
      () => null
    );
    const needIdx: number[] = [];
    for (let i = 0; i < toEnrich.length; i++) {
      const eid = String(toEnrich[i].row.id);
      const stored = existingByEid.get(eid)?.description_raw;
      if (hasStashedRealDescription(K12_FOOTER, stored)) {
        fromDetail[i] = {
          desc: stored!.trim(),
          applyUrl: toEnrich[i].applyFallback,
        };
      } else {
        needIdx.push(i);
      }
    }

    if (needIdx.length > 0) {
      const fetched = await mapWithConcurrency(needIdx, DETAIL_FETCH_CONCURRENCY, async (i) => {
        const st = toEnrich[i];
        const json = await fetchJobDetailJson(st.row.id);
        if (!json) return null;
        const paras = json.paragraphs as K12Paragraph[] | undefined;
        const desc = textFromParagraphs(paras);
        return { desc, applyUrl: st.applyFallback };
      });
      for (let j = 0; j < needIdx.length; j++) {
        fromDetail[needIdx[j]] = fetched[j];
      }
    }

    const out: NormalizedJob[] = [];
    for (let i = 0; i < stubs.length; i++) {
      const { row, applyFallback, synthetic } = stubs[i];
      const title = (row.title ?? "").trim();
      const companyName = (row.hiringOrganization ?? "School or district").trim();
      const locRaw = formatLocationFromListJob(row);
      const jl0 = row.jobLocation?.[0];
      const remote =
        jl0?.isRemote === true || row.location?.isRemote === true;

      const detail = i < MAX_DETAIL_JOBS && fromDetail[i] ? fromDetail[i]! : null;
      const descBody = detail?.desc && detail.desc.trim().length >= 20 ? detail.desc : null;
      const applyUrl = detail?.applyUrl?.trim() || applyFallback;
      const descriptionRaw = descBody ?? synthetic;
      const posted = parseDateSec(row.postedDate, nowSec);

      out.push({
        external_id: String(row.id),
        title,
        location: normalizeLocation(locRaw),
        employment_type: normalizeEmploymentType(null),
        workplace_type: remote ? "remote" : normalizeWorkplaceType(null, locRaw),
        apply_url: applyUrl,
        source_url: buildPublicJobUrl(row.id),
        description_raw: descriptionRaw,
        salary_min: null,
        salary_max: null,
        salary_currency: null,
        salary_period: null,
        posted_at: posted,
        company_name: companyName,
        company_logo_url: null,
        company_website_url: null,
      });
    }

    return out;
  },
};
