/**
 * Thanks for using Curastem! Curastem is a 501(c)(3) non-profit dedicated to connecting
 * high-quality talent with job opportunities. Our mission is to serve underserved job
 * applicants and support local communities. Consider joining us on this mission. Questions?
 * Contact developers@curastem.org
 *
 * EDJOIN (K–12 education) job board — **plain HTTP only** (no Browser Rendering).
 *
 * The public “Jobs” UI at edjoin.org loads listings via the same unauthenticated
 * `GET /Home/LoadJobs?…` JSON endpoint the browser uses. Parameters match
 * `Scripts/pages/jobs.js` `buildSearchQueryString()`; `stateID` filters by U.S. state
 * (24 = California in their catalog).
 *
 * `base_url` must include a `stateID` query (e.g. `https://www.edjoin.org/?stateID=24`).
 * Only that parameter is read; all other search filters are left empty (same as a blank search
 * for that state).
 *
 * The list response does not include full job text. **Phase 2** GETs
 * `/Home/JobPosting/{id}` and reads `jobSummary` from schema.org `JobPosting`
 * JSON-LD (or the visible Job Summary paragraph as fallback). The same page
 * carries **Employment Type** (e.g. "Full Time" / "Part Time") in JSON-LD
 * `employmentType` and/or an `h3` + `p` block — we prefer that over list
 * `FullTimePartTime` when present. A cap on detail fetches per run matches
 * Workday, jobs beyond the cap keep the list-phase synthetic blurb.
 *
 * Large states can return tens of thousands of rows; we cap the number of list pages
 * per cron run to stay under Worker CPU limits.
 *
 * **Detail GET skip:** when `env.JOBS_DB` is available, we load existing
 * `description_raw` for the detail batch and **omit HTML fetches** for rows that
 * already have a non-synthetic body (editing is rare; list stubs match
 * `EDJOIN_SYNTHETIC_FOOTER`). New postings and stub-only rows still get a GET.
 */

import { batchGetExistingJobs } from "../../db/queries.ts";
import type { Env, JobSource, NormalizedJob, SourceRow } from "../../types.ts";
import { parseJsonLenientUnknown } from "../../utils/jsonLenientParse.ts";
import type { EmploymentType } from "../../types.ts";
import {
  normalizeEmploymentType,
  normalizeLocation,
  normalizeWorkplaceType,
  parseSalary,
} from "../../utils/normalize.ts";

const USER_AGENT = "Curastem-Jobs-Ingestion/1.0 (developers@curastem.org)";

const ORIGIN = "https://www.edjoin.org";

/** Same cap order of magnitude as Workday list phase — keeps hourly ingest under the Worker limit. */
const MAX_JOBS_PER_RUN = 2000;

/** Per-job detail HTML fetches in Phase 2 (same order of magnitude as Workday). */
const MAX_DETAIL_JOBS = 400;

const DETAIL_FETCH_CONCURRENCY = 16;

/** Prefer larger page sizes to reduce request count (server accepts at least 100). */
const MAX_ROWS = 100;

interface EdjoinJobRow {
  postingID: number;
  positionTitle: string;
  salaryInfo: string | null;
  postingDate: string | null;
  countyName: string | null;
  districtName: string | null;
  city: string | null;
  stateName: string | null;
  fullCountyName: string | null;
  FullTimePartTime: string | null;
  jobType: string | null;
}

interface EdjoinLoadResponse {
  totalPages: number;
  totalRecords: number;
  data: EdjoinJobRow[] | null;
}

/** ASP.NET /Date( ms )/ or /Date(-6213556800000)/ (epoch null). */
function parseDotNetDateJson(raw: string | null | undefined): number | null {
  if (!raw || typeof raw !== "string") return null;
  const m = raw.match(/\/Date\((-?\d+)\)\//);
  if (!m) return null;
  const ms = parseInt(m[1], 10);
  if (Number.isNaN(ms) || ms < 0) return null;
  return Math.floor(ms / 1000);
}

function parseStateId(baseUrl: string): number {
  const u = new URL(baseUrl);
  const v = u.searchParams.get("stateID");
  if (v) {
    const n = parseInt(v, 10);
    if (!Number.isNaN(n) && n > 0) return n;
  }
  throw new Error(
    "edjoin: base_url must include a positive stateID query, e.g. ?stateID=24 (California)"
  );
}

function buildLoadJobsUrl(
  stateID: number,
  page: number,
  rows: number
): string {
  const p = new URLSearchParams();
  p.set("rows", String(rows));
  p.set("page", String(page));
  p.set("sort", "postingDate");
  p.set("sortVal", "0");
  p.set("order", "desc");
  p.set("keywords", "");
  p.set("location", "");
  p.set("searchType", "all");
  p.set("regions", "");
  p.set("jobTypes", "");
  p.set("days", "0");
  p.set("empType", "");
  p.set("catID", "0");
  p.set("onlineApps", "");
  p.set("recruitmentCenterID", "0");
  p.set("stateID", String(stateID));
  p.set("regionID", "0");
  p.set("districtID", "0");
  p.set("searchID", "0");
  return `${ORIGIN}/Home/LoadJobs?${p.toString()}`;
}

function buildLocationString(row: EdjoinJobRow): string {
  const city = (row.city ?? "").trim();
  const county = (row.fullCountyName ?? row.countyName ?? "").trim();
  const st = (row.stateName ?? "").trim();
  const parts: string[] = [];
  if (city) parts.push(city);
  if (county && !county.toLowerCase().includes(city.toLowerCase())) parts.push(county);
  if (st) parts.push(st);
  return parts.length ? parts.join(", ") : county || st || "United States";
}

const EDJOIN_SYNTHETIC_FOOTER =
  "Listing source: EDJOIN (California County Superintendents Educational Services Association).";

function buildSyntheticDescription(row: EdjoinJobRow, loc: string): string {
  const lines: string[] = [];
  const employer = (row.districtName ?? row.countyName ?? "K-12 employer").trim();
  lines.push(`Organization: ${employer}`);
  lines.push(`Role: ${(row.positionTitle ?? "").trim()}`);
  if (loc) lines.push(`Location: ${loc}`);
  if (row.jobType) lines.push(`Type: ${row.jobType.trim()}`);
  if (row.FullTimePartTime) lines.push(`Employment: ${row.FullTimePartTime.trim()}`);
  const sal = (row.salaryInfo ?? "").trim();
  if (sal) lines.push(`Compensation: ${sal}`);
  lines.push(EDJOIN_SYNTHETIC_FOOTER);
  return lines.join("\n");
}

function isEdjoinListSyntheticBlurb(d: string | null | undefined): boolean {
  if (!d || !d.trim()) return false;
  return d.includes(EDJOIN_SYNTHETIC_FOOTER);
}

/** Reuse D1 `description_raw` and skip a detail GET: real body never matched our list-only stub. */
function hasStashedEdjoinDetailForSkip(d: string | null | undefined): boolean {
  if (!d || !d.trim()) return false;
  if (isEdjoinListSyntheticBlurb(d)) return false;
  return d.trim().length >= 40;
}

/** EDJOIN uses non-standard `jobSummary` in JSON-LD; `description` is often a placeholder. */
const PLACEHOLDER_LIKE = /^(see attachment|see the original|n\/a|tbd|none)\b/i;

function isEdjoinBodyText(s: string | null | undefined): s is string {
  if (!s || typeof s !== "string") return false;
  const t = s.trim();
  if (t.length < 20) return false;
  if (PLACEHOLDER_LIKE.test(t)) return false;
  return true;
}

function textFromJobPostingObject(o: Record<string, unknown>): string | null {
  const jobSummary = o["jobSummary"];
  const description = o["description"];
  if (isEdjoinBodyText(String(jobSummary))) return String(jobSummary).trim();
  if (isEdjoinBodyText(String(description))) return String(description).trim();
  return null;
}

/** schema.org URL or plain string (e.g. `https://schema.org/FULL_TIME`). */
function rawEmploymentTypeFromSchemaValue(raw: unknown): string | null {
  if (raw == null) return null;
  const s =
    typeof raw === "string"
      ? raw
      : Array.isArray(raw) && typeof raw[0] === "string"
        ? raw[0]
        : null;
  if (!s) return null;
  const t = s.trim();
  if (!t) return null;
  if (/^https?:\/\//i.test(t)) {
    const seg = t.split(/[/#]/).filter(Boolean).pop() ?? "";
    if (!seg) return null;
    return seg.replace(/_/g, " ").trim() || null;
  }
  return t;
}

function findEdjoinEmploymentTypeInLdNode(obj: unknown): string | null {
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  const t = o["@type"];
  if (t === "JobPosting" || (Array.isArray(t) && t.includes("JobPosting"))) {
    return rawEmploymentTypeFromSchemaValue(o["employmentType"]);
  }
  if (Array.isArray(o["@graph"])) {
    for (const node of o["@graph"]) {
      const e = findEdjoinEmploymentTypeInLdNode(node);
      if (e) return e;
    }
  }
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const e = findEdjoinEmploymentTypeInLdNode(item);
      if (e) return e;
    }
  }
  return null;
}

/**
 * First JSON-LD `JobPosting.employmentType` (Google often uses schema.org URL tokens).
 */
function extractEdjoinEmploymentTypeFromJsonLd(html: string): string | null {
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const data = parseJsonLenientUnknown(m[1].trim());
    if (data == null) continue;
    const e = findEdjoinEmploymentTypeInLdNode(data);
    if (e) return e;
  }
  return null;
}

/**
 * Visible "Employment Type" / "Full Time" block on the job posting page (line break
 * between label and value is common).
 */
function extractEdjoinEmploymentTypeFromDom(html: string): string | null {
  const patterns: RegExp[] = [
    /<h3[^>]*>\s*Employment Type\s*<\/h3>\s*<p[^>]*>([\s\S]*?)<\/p>/i,
    /<h3[^>]*>\s*Employment Type\s*<\/h3>\s*<div[^>]*>([\s\S]*?)<\/div>/i,
    /<h4[^>]*>\s*Employment Type\s*<\/h4>\s*<p[^>]*>([\s\S]*?)<\/p>/i,
    /<dt[^>]*>\s*Employment Type\s*<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/i,
    /<td[^>]*>\s*Employment Type\s*<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/i,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m) {
      const text = m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      if (text.length >= 2 && text.length < 160) return text;
    }
  }
  return null;
}

function extractEdjoinEmploymentTypeFromDetailHtml(html: string): string | null {
  return (
    extractEdjoinEmploymentTypeFromJsonLd(html) ?? extractEdjoinEmploymentTypeFromDom(html)
  );
}

/**
 * List API + on-page label → normalized `employment_type`. Handles multi-word
 * school-district phrasing (e.g. "Substitute - Part Time") when the exact string
 * is not in the global map.
 */
function normalizeEdjoinEmploymentType(raw: string | null | undefined): EmploymentType | null {
  if (!raw) return null;
  const direct = normalizeEmploymentType(raw);
  if (direct) return direct;
  const k = raw.toLowerCase();
  if (k.includes("substitute")) return "temporary";
  if (k.includes("per diem")) return "part_time";
  if (k.includes("part") && k.includes("time")) return "part_time";
  if (k.includes("full") && k.includes("time")) return "full_time";
  if (/\b(temp(orary)?|short[-\s]term)\b/.test(k)) return "temporary";
  if (k.includes("contract") || k.includes("1099") || k.includes("freelance")) return "contract";
  if (k.includes("volunteer") || k.includes("unpaid")) return "volunteer";
  if (k.includes("intern")) return "temporary";
  return null;
}

function findEdjoinTextInLdNode(obj: unknown): string | null {
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  const t = o["@type"];
  if (t === "JobPosting" || (Array.isArray(t) && t.includes("JobPosting"))) {
    return textFromJobPostingObject(o);
  }
  if (Array.isArray(o["@graph"])) {
    for (const node of o["@graph"]) {
      const d = findEdjoinTextInLdNode(node);
      if (d) return d;
    }
  }
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const d = findEdjoinTextInLdNode(item);
      if (d) return d;
    }
  }
  return null;
}

/**
 * First `application/ld+json` JobPosting: prefer `jobSummary`, then a non-placeholder
 * `description`.
 */
function extractEdjoinDescriptionFromJsonLd(html: string): string | null {
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const data = parseJsonLenientUnknown(m[1].trim());
    if (data == null) continue;
    const d = findEdjoinTextInLdNode(data);
    if (d) return d;
  }
  return null;
}

/**
 * When JSON-LD omits a useful summary, the "Job Summary" copy lives in
 * `p.indent` with `white-space:pre-line` on many postings.
 */
function extractEdjoinJobSummaryFromDom(html: string): string | null {
  const m = html.match(
    /<h3[^>]*>\s*Job Summary\s*<\/h3>[\s\S]*?<p class="indent"[^>]*style="white-space:\s*pre-line"[^>]*>([\s\S]*?)<\/p>/i
  );
  if (m) {
    const t = m[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    if (isEdjoinBodyText(t)) return t;
  }
  return null;
}

function extractEdjoinDescriptionFromDetailHtml(html: string): string | null {
  return (
    extractEdjoinDescriptionFromJsonLd(html) ?? extractEdjoinJobSummaryFromDom(html)
  );
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

interface EdjoinDetailPageParse {
  description: string | null;
  /** Raw label from JSON-LD or "Employment Type" row on the HTML page. */
  employmentTypeRaw: string | null;
}

async function fetchEdjoinDetailPage(applyUrl: string): Promise<EdjoinDetailPageParse> {
  const res = await fetch(applyUrl, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  });
  if (!res.ok) return { description: null, employmentTypeRaw: null };
  const html = await res.text();
  return {
    description: extractEdjoinDescriptionFromDetailHtml(html),
    employmentTypeRaw: extractEdjoinEmploymentTypeFromDetailHtml(html),
  };
}

interface EdjoinStub {
  row: EdjoinJobRow;
  locRaw: string;
  applyUrl: string;
  synthetic: string;
}

export const edjoinFetcher: JobSource = {
  sourceType: "edjoin",

  async fetch(source: SourceRow, env?: Env): Promise<NormalizedJob[]> {
    const stateID = parseStateId(source.base_url);
    // UI default page size is 10; the API accepts 100+ which cuts requests ~10×.
    const rows = MAX_ROWS;

    const stubs: EdjoinStub[] = [];
    let page = 1;

    while (stubs.length < MAX_JOBS_PER_RUN) {
      const url = buildLoadJobsUrl(stateID, page, rows);
      const res = await fetch(url, {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "application/json, */*;q=0.8",
        },
      });
      if (!res.ok) {
        throw new Error(`EDJOIN LoadJobs ${res.status} for ${source.id}`);
      }
      let data: EdjoinLoadResponse;
      try {
        data = (await res.json()) as EdjoinLoadResponse;
      } catch {
        throw new Error(`EDJOIN invalid JSON for ${source.id}`);
      }
      const batch = data.data ?? [];
      if (batch.length === 0) break;

      for (const row of batch) {
        if (stubs.length >= MAX_JOBS_PER_RUN) break;
        const title = (row.positionTitle ?? "").trim();
        if (!title) continue;

        const locRaw = buildLocationString(row);
        const applyUrl = `${ORIGIN}/Home/JobPosting/${row.postingID}`;
        const synthetic = buildSyntheticDescription(row, locRaw);
        stubs.push({ row, locRaw, applyUrl, synthetic });
      }

      if (page >= (data.totalPages ?? 0)) break;
      if (batch.length < rows) break;
      page += 1;
    }

    const toEnrich = stubs.slice(0, MAX_DETAIL_JOBS);
    const externalIds = toEnrich.map((s) => String(s.row.postingID));
    const existingByEid =
      env?.JOBS_DB && externalIds.length > 0
        ? await batchGetExistingJobs(env.JOBS_DB, source.id, externalIds)
        : new Map<string, { id: string; description_raw: string | null }>();

    const fromDetail: Array<string | null> = new Array(toEnrich.length).fill(null);
    const fromDetailEmployment: Array<string | null> = new Array(toEnrich.length).fill(
      null
    );
    const needFetchIdx: number[] = [];
    for (let i = 0; i < toEnrich.length; i++) {
      const eid = String(toEnrich[i].row.postingID);
      const stored = existingByEid.get(eid)?.description_raw;
      if (hasStashedEdjoinDetailForSkip(stored)) {
        fromDetail[i] = stored!.trim();
        // We did not re-fetch HTML — no on-page employment type; use list FTE only.
      } else {
        needFetchIdx.push(i);
      }
    }
    if (needFetchIdx.length > 0) {
      const fetched = await mapWithConcurrency(
        needFetchIdx,
        DETAIL_FETCH_CONCURRENCY,
        (i) => fetchEdjoinDetailPage(toEnrich[i].applyUrl)
      );
      for (let j = 0; j < needFetchIdx.length; j++) {
        const p = fetched[j]!;
        fromDetail[needFetchIdx[j]] = p.description;
        fromDetailEmployment[needFetchIdx[j]] = p.employmentTypeRaw?.trim() ?? null;
      }
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const out: NormalizedJob[] = [];
    for (let i = 0; i < stubs.length; i++) {
      const { row, locRaw, applyUrl, synthetic } = stubs[i];
      const title = (row.positionTitle ?? "").trim();
      const companyName = (row.districtName ?? row.countyName ?? "School District").trim();
      const listFte = row.FullTimePartTime ?? null;
      const detailEtRaw = i < MAX_DETAIL_JOBS ? fromDetailEmployment[i] : null;
      const employment_type = normalizeEdjoinEmploymentType(detailEtRaw ?? listFte);
      const salHint = (row.salaryInfo ?? "").trim() || null;
      const sal = salHint
        ? parseSalary(salHint)
        : { min: null, max: null, currency: null, period: null };

      const fromPage = i < MAX_DETAIL_JOBS ? fromDetail[i] : null;
      const descriptionRaw = (fromPage && isEdjoinBodyText(fromPage) ? fromPage : null) ?? synthetic;

      out.push({
        external_id: String(row.postingID),
        title,
        location: normalizeLocation(locRaw),
        employment_type,
        workplace_type: normalizeWorkplaceType(null, locRaw),
        apply_url: applyUrl,
        source_url: applyUrl,
        description_raw: descriptionRaw,
        salary_min: sal.min,
        salary_max: sal.max,
        salary_currency: sal.currency,
        salary_period: sal.period,
        posted_at: parseDotNetDateJson(row.postingDate) ?? nowSec,
        company_name: companyName,
        company_logo_url: null,
        company_website_url: null,
      });
    }

    return out;
  },
};

/**
 * @internal Used by `scripts/smoke-education-sources.ts` to assert employment
 * type is read from a saved JobPosting HTML sample.
 */
export function edjoinEmploymentTypeFromDetailForSmoke(html: string): string | null {
  return extractEdjoinEmploymentTypeFromDetailHtml(html);
}
