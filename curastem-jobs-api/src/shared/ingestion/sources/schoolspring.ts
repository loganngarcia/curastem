/**
 * SchoolSpring (K–12 / education) — **plain `fetch` only** (no Browser Rendering).
 *
 * The public jobs SPA loads results from `GET https://api.schoolspring.com/api/Jobs/…`
 * with a `domainName` query (national board: `www.schoolspring.com`). The list endpoint
 * returns job ids, title, employer, location, and dates; full HTML descriptions come from
 * `GET /api/Jobs/{jobId}?domainName=…` (`value.jobInfo.jobDescription`).
 *
 * `base_url` is the job board page you want to mirror, e.g. `https://www.schoolspring.com/jobs`.
 * Optional **query** parameters are forwarded to the API: `domainName`, `keyword`, `location`,
 * `category`, `gradelevel`, `jobtype`, `organization`, `swLat`, `swLon`, `neLat`, `neLon`
 * (defaults: empty strings; map bounds `0,0` → `90,180` so the search matches the national UI).
 * Endpoints match the public SPA bundle; there is no separate public API manual.
 *
 * `description_raw` is **plain text** (HTML from the API is passed through `htmlToText`). Up to
 * `MAX_DETAIL_JOBS` postings load detail JSON per run; the rest use a short synthetic blurb. When
 * `env.JOBS_DB` is set, existing non-synthetic descriptions skip the detail call (see EDJOIN).
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

const API_ORIGIN = "https://api.schoolspring.com";
const DEFAULT_WEB = "https://www.schoolspring.com";

const MAX_JOBS_PER_RUN = 2000;
const MAX_DETAIL_JOBS = 400;
const DETAIL_FETCH_CONCURRENCY = 16;
const PAGE_SIZE = 100;

const SCHOOLSPRING_LISTING_FOOTER =
  "Listing source: SchoolSpring (K–12 education job board, PowerSchool).";

interface SchoolspringListRow {
  jobId: number;
  employer: string;
  title: string;
  location: string;
  displayDate: string | null;
}

interface PagedListResponse {
  success: boolean;
  value?: { page: number; size: number; jobsList: SchoolspringListRow[] };
}

interface JobDetailInfo {
  jobId: number;
  jobTitle: string;
  jobDescription?: string | null;
  infoURL?: string | null;
  postDate?: string | null;
  displayDate?: string | null;
}

interface JobDetailResponse {
  success: boolean;
  value?: { jobInfo: JobDetailInfo | null };
}

function hasStashedRealDescription(
  syntheticFooter: string,
  d: string | null | undefined
): boolean {
  if (!d || !d.trim()) return false;
  if (d.includes(syntheticFooter)) return false;
  return d.trim().length >= 40;
}

function parseDateSec(raw: string | null | undefined, fallback: number): number {
  if (!raw) return fallback;
  const ms = Date.parse(raw);
  if (Number.isNaN(ms)) return fallback;
  return Math.floor(ms / 1000);
}

export interface SchoolspringQuery {
  domainName: string;
  keyword: string;
  location: string;
  category: string;
  gradelevel: string;
  jobtype: string;
  organization: string;
  swLat: number;
  swLon: number;
  neLat: number;
  neLon: number;
}

function parseBaseUrlToQuery(baseUrl: string): SchoolspringQuery {
  const u = new URL(baseUrl);
  const sp = u.searchParams;
  const defHost = u.hostname && u.hostname.includes("schoolspring") ? u.hostname : "www.schoolspring.com";
  return {
    domainName: sp.get("domainName") || defHost,
    keyword: sp.get("keyword") ?? "",
    location: sp.get("location") ?? "",
    category: sp.get("category") ?? "",
    gradelevel: sp.get("gradelevel") ?? "",
    jobtype: sp.get("jobtype") ?? "",
    organization: sp.get("organization") ?? "",
    swLat: parseFloat(sp.get("swLat") || "0") || 0,
    swLon: parseFloat(sp.get("swLon") || "0") || 0,
    neLat: parseFloat(sp.get("neLat") || "90") || 90,
    neLon: parseFloat(sp.get("neLon") || "180") || 180,
  };
}

function buildListSearchString(q: SchoolspringQuery, page: number): string {
  const p = new URLSearchParams();
  p.set("domainName", q.domainName);
  p.set("keyword", q.keyword);
  p.set("location", q.location);
  p.set("category", q.category);
  p.set("gradelevel", q.gradelevel);
  p.set("jobtype", q.jobtype);
  p.set("organization", q.organization);
  p.set("swLat", String(q.swLat));
  p.set("swLon", String(q.swLon));
  p.set("neLat", String(q.neLat));
  p.set("neLon", String(q.neLon));
  p.set("page", String(page));
  p.set("size", String(PAGE_SIZE));
  p.set("sortDateAscending", "false");
  return `${API_ORIGIN}/api/Jobs/GetPagedJobsWithSearch?${p.toString()}`;
}

function buildJobDetailUrl(jobId: number, q: SchoolspringQuery): string {
  const p = new URLSearchParams();
  p.set("domainName", q.domainName);
  return `${API_ORIGIN}/api/Jobs/${jobId}?${p.toString()}`;
}

function publicJobPageUrl(jobId: number): string {
  return `${DEFAULT_WEB}/jobdetail/${jobId}`;
}

function buildSynthetic(employer: string, title: string, loc: string): string {
  const lines: string[] = [];
  const org = (employer || "School or district").trim();
  lines.push(`Organization: ${org}`);
  lines.push(`Role: ${(title || "").trim()}`);
  if (loc.trim()) lines.push(`Location: ${loc.trim()}`);
  lines.push(SCHOOLSPRING_LISTING_FOOTER);
  return lines.join("\n");
}

function textFromJobHtml(raw: string | null | undefined): string | null {
  if (raw == null || !String(raw).trim()) return null;
  const t = htmlToText(String(raw));
  return t.length > 0 ? t : null;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += limit) {
    const chunk = items.slice(i, i + limit);
    out.push(...(await Promise.all(chunk.map((x) => fn(x)))));
  }
  return out;
}

interface Stub {
  row: SchoolspringListRow;
  applyFallback: string;
  synthetic: string;
}

export const schoolspringFetcher: JobSource = {
  sourceType: "schoolspring",

  async fetch(source: SourceRow, env?: Env): Promise<NormalizedJob[]> {
    const q = parseBaseUrlToQuery(source.base_url);
    const nowSec = Math.floor(Date.now() / 1000);
    const stubs: Stub[] = [];
    let page = 1;

    while (stubs.length < MAX_JOBS_PER_RUN) {
      const url = buildListSearchString(q, page);
      const res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      });
      if (!res.ok) {
        throw new Error(`SchoolSpring GetPagedJobsWithSearch ${res.status} for ${source.id}`);
      }
      let data: PagedListResponse;
      try {
        data = (await res.json()) as PagedListResponse;
      } catch {
        throw new Error(`SchoolSpring invalid JSON for ${source.id}`);
      }
      if (!data.success) {
        throw new Error(`SchoolSpring list error for ${source.id}`);
      }
      const list = data.value?.jobsList ?? [];
      if (list.length === 0) break;

      for (const row of list) {
        if (stubs.length >= MAX_JOBS_PER_RUN) break;
        const title = (row.title ?? "").trim();
        if (!title) continue;
        const loc = (row.location ?? "").trim();
        const companyName = (row.employer ?? "School or district").trim();
        const jid = row.jobId;
        const applyFallback = publicJobPageUrl(jid);
        const synthetic = buildSynthetic(companyName, title, loc);
        stubs.push({ row, applyFallback, synthetic });
      }

      if (list.length < PAGE_SIZE) break;
      page += 1;
    }

    const toEnrich = stubs.slice(0, MAX_DETAIL_JOBS);
    const externalIds = toEnrich.map((s) => String(s.row.jobId));
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
      const eid = String(toEnrich[i].row.jobId);
      const stored = existingByEid.get(eid)?.description_raw;
      if (hasStashedRealDescription(SCHOOLSPRING_LISTING_FOOTER, stored)) {
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
        const detailUrl = buildJobDetailUrl(st.row.jobId, q);
        const res = await fetch(detailUrl, {
          headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
        });
        if (!res.ok) return null;
        let body: JobDetailResponse;
        try {
          body = (await res.json()) as JobDetailResponse;
        } catch {
          return null;
        }
        if (!body.success || !body.value?.jobInfo) return null;
        const info = body.value.jobInfo;
        const desc = textFromJobHtml(info.jobDescription);
        const apply =
          (info.infoURL && info.infoURL.trim()) || st.applyFallback;
        return { desc, applyUrl: apply };
      });
      for (let j = 0; j < needIdx.length; j++) {
        fromDetail[needIdx[j]] = fetched[j];
      }
    }

    const out: NormalizedJob[] = [];
    for (let i = 0; i < stubs.length; i++) {
      const { row, applyFallback, synthetic } = stubs[i];
      const title = (row.title ?? "").trim();
      const companyName = (row.employer ?? "School or district").trim();
      const locRaw = (row.location ?? "").trim() || "United States";

      const detail =
        i < MAX_DETAIL_JOBS && fromDetail[i] ? fromDetail[i]! : null;
      const descBody =
        detail?.desc && detail.desc.trim().length >= 20 ? detail.desc : null;
      const applyUrl = detail?.applyUrl?.trim() || applyFallback;
      const descriptionRaw = descBody ?? synthetic;
      const posted = parseDateSec(
        row.displayDate,
        nowSec
      );

      out.push({
        external_id: String(row.jobId),
        title,
        location: normalizeLocation(locRaw),
        employment_type: normalizeEmploymentType(null),
        workplace_type: normalizeWorkplaceType(null, locRaw),
        apply_url: applyUrl,
        source_url: publicJobPageUrl(row.jobId),
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
