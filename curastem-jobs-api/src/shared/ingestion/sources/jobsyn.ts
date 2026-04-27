/**
 * Jobsyn (e.g. Pearson Jobs) — `prod-search-api.jobsyn.org` listing + `microsites.dejobs.org`
 * detail JSON.
 *
 * This fetcher handles Pearson-style Jobsyn boards that expose:
 * - list API: `GET /api/v1/solr/search?source={source}&num_items=...&sort=relevance&page=...&q=`
 * - detail API: `GET https://microsites.dejobs.org/{job-folder}/data/{GUID}.json`
 *
 * `base_url` is any concrete job URL from the board, used only as a template for
 * apply URL slug segments.
 */

import { batchGetExistingJobs } from "../../db/queries.ts";
import type { Env, JobSource, NormalizedJob, SourceRow } from "../../types.ts";
import {
  htmlToText,
  normalizeEmploymentType,
  normalizeLocation,
  normalizeWorkplaceType,
  parseEpochSeconds,
} from "../../utils/normalize.ts";

const USER_AGENT = "Curastem-Jobs-Ingestion/1.0 (developers@curastem.org)";

const LIST_API = "https://prod-search-api.jobsyn.org/api/v1/solr/search";
const DETAIL_API = "https://microsites.dejobs.org";
const APPLY_ORIGIN = "https://pearson.jobs";
const JOBSYN_SOURCE = "pearson-jobs";
const JOB_FOLDER = "pearson-jobs";
const LIST_PAGE_SIZE = 15; // API returns 15 even with larger num_items in observed responses.

const MAX_JOBS_PER_RUN = 800;
const DETAIL_FETCH_CONCURRENCY = 8;
const MIN_SUBSTANTIVE_BODY = 120;
const DEFAULT_CITY_SLUG = "jobs";
const DEFAULT_TITLE_SLUG = "position";

const GUID_RE = /^[0-9A-F]{32}$/i;

interface JobsynPagination {
  has_more_pages?: boolean;
  offset?: number;
  page?: number;
  page_size?: number;
  total?: number;
  total_pages?: number;
}

interface JobsynListJob {
  guid?: string | number;
  title_exact?: string | null;
  title_slug?: string | null;
  description?: string | null;
  location_exact?: string | null;
  company_exact?: string | null;
  job_type?: string | null;
  job_shift?: string | null;
  date_added?: string | number | null;
  date_updated?: string | number | null;
  date_new?: string | number | null;
}

interface JobsynListResponse {
  jobs?: JobsynListJob[];
  pagination?: JobsynPagination;
}

interface JobsynDetail {
  guid?: string | number;
  title?: string | null;
  title_exact?: string | null;
  title_slug?: string | null;
  description?: string | null;
  html_description?: string | null;
  location?: string | null;
  location_exact?: string | null;
  city_slug?: string | null;
  state_short?: string | null;
  job_type?: string | null;
  job_shift?: string | null;
  date_added?: string | number | null;
  date_updated?: string | number | null;
  date_new?: string | null;
  company_exact?: string | null;
}

interface ParsedBase {
  templateCitySlug: string;
  templateTitleSlug: string;
}

interface JobsynStub {
  guid: string;
  title: string;
  titleSlug: string;
  locationRaw: string | null;
  listDescription: string | null;
  listCitySlug: string | null;
  employmentTypeRaw: string | null;
  postedAt: string | number | null;
}

function toSlug(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .replace(/-+/g, "-");
}

function parseBaseUrl(baseUrl: string): ParsedBase {
  const u = new URL(baseUrl);
  const parts = u.pathname.split("/").filter(Boolean);
  if (parts.length === 0) {
    return { templateCitySlug: DEFAULT_CITY_SLUG, templateTitleSlug: DEFAULT_TITLE_SLUG };
  }

  let citySegment: string | undefined;
  let titleSegment: string | undefined;

  for (let i = 0; i < parts.length; i++) {
    if (GUID_RE.test(parts[i])) {
      citySegment = parts[i - 2];
      titleSegment = parts[i - 1];
      break;
    }
  }

  if (!citySegment && !titleSegment && parts.length >= 2) {
    citySegment = parts[0];
    titleSegment = parts[1];
  }

  const templateCitySlug = citySegment ? toSlug(citySegment) : DEFAULT_CITY_SLUG;
  const templateTitleSlug = titleSegment ? toSlug(titleSegment) : DEFAULT_TITLE_SLUG;
  return { templateCitySlug, templateTitleSlug };
}

function buildListUrl(page: number): string {
  const params = new URLSearchParams({
    source: JOBSYN_SOURCE,
    num_items: String(LIST_PAGE_SIZE),
    sort: "relevance",
    q: "",
    page: String(page),
  });
  return `${LIST_API}?${params.toString()}`;
}

async function fetchPage(page: number): Promise<JobsynListResponse> {
  const res = await fetch(buildListUrl(page), {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/json",
      "x-origin": APPLY_ORIGIN.replace(/^https?:\/\//, ""),
    },
  });
  if (!res.ok) {
    throw new Error(`jobsyn list failed page ${page}: ${res.status}`);
  }
  return (await res.json()) as JobsynListResponse;
}

async function fetchDetail(guid: string): Promise<JobsynDetail | null> {
  try {
    const res = await fetch(`${DETAIL_API}/${JOB_FOLDER}/data/${guid.toUpperCase()}.json`, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json",
      },
    });
    if (!res.ok) return null;
    return (await res.json()) as JobsynDetail;
  } catch {
    return null;
  }
}

function listEmploymentType(raw: string | null | undefined) {
  if (!raw) return null;
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/_+/g, "-");
  return (
    normalizeEmploymentType(normalized) ??
    (normalized.includes("part") ? "part_time" : null) ??
    (normalized.includes("contract") ? "contract" : null) ??
    (normalized.includes("temporary") || normalized.includes("temp") ? "temporary" : null) ??
    null
  );
}

function parseText(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const txt = htmlToText(String(raw)).trim();
  return txt.length > 0 ? txt : null;
}

function isSubstantive(raw: string | null | undefined): boolean {
  return typeof raw === "string" && raw.trim().length >= MIN_SUBSTANTIVE_BODY;
}

function citySlugFromParts(citySlug: string | null | undefined, stateShort: string | null | undefined): string | null {
  const city = toSlug(citySlug ?? "");
  if (!city) return null;
  const state = toSlug(stateShort ?? "");
  if (!state) return city;
  if (state.length === 2) return `${city}-${state}`;
  if (state.length <= 3) return `${city}-${state}`;
  return city;
}

function citySlugFromLocation(location: string | null | undefined): string | null {
  if (!location) return null;
  const [cityRaw, stateRaw] = location.split(",").map((x) => x.trim()).filter(Boolean);
  if (!cityRaw) return null;
  const city = toSlug(cityRaw);
  if (!city) return null;
  const state = stateRaw ? toSlug(stateRaw.split(" ")[0] ?? "") : "";
  if (!state) return city;
  return `${city}-${state.slice(0, 3)}`;
}

function buildApplyUrl(guid: string, citySlug: string | null, titleSlug: string | null, template: ParsedBase): string {
  const city = citySlug || template.templateCitySlug || DEFAULT_CITY_SLUG;
  const title = titleSlug || template.templateTitleSlug || DEFAULT_TITLE_SLUG;
  return `${APPLY_ORIGIN}/${city}/${title}/${guid}/job/`;
}

function pickDetailCitySlug(detail: JobsynDetail | null): string | null {
  if (!detail) return null;
  const fromCity = citySlugFromParts(detail.city_slug ?? null, detail.state_short ?? null);
  if (fromCity) return fromCity;
  return citySlugFromLocation(detail.location_exact ?? detail.location ?? null);
}

function pickListCitySlug(job: JobsynListJob): string | null {
  return citySlugFromLocation(job.location_exact ?? null);
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return out;
}

export const jobsynFetcher: JobSource = {
  sourceType: "jobsyn",

  async fetch(source: SourceRow, env?: Env): Promise<NormalizedJob[]> {
    const template = parseBaseUrl(source.base_url);
    const stubs: JobsynStub[] = [];
    const seen = new Set<string>();
    let totalPages = 1;

    for (let page = 1; page <= totalPages && stubs.length < MAX_JOBS_PER_RUN; page++) {
      const payload = await fetchPage(page);
      const jobs = payload.jobs ?? [];
      if (jobs.length === 0) break;

      if (Number.isFinite(payload.pagination?.total_pages as number) && payload.pagination?.total_pages) {
        totalPages = payload.pagination.total_pages;
      }

      for (const row of jobs) {
        if (stubs.length >= MAX_JOBS_PER_RUN) break;
        const guid = typeof row.guid === "string" ? row.guid.trim() : typeof row.guid === "number" ? String(row.guid) : "";
        if (!guid || !GUID_RE.test(guid) || seen.has(guid)) continue;

        const title = String(row.title_exact ?? "Position").trim();
        const listTitleSlug = toSlug(row.title_slug ?? title);
        const locationRaw = row.location_exact ? normalizeLocation(row.location_exact) : null;
        const employmentTypeRaw = (row.job_type ?? row.job_shift ?? null) as string | null;
        const listDescription = parseText(row.description ?? null);
        const listCitySlug = pickListCitySlug(row);

        stubs.push({
          guid,
          title,
          titleSlug: listTitleSlug || DEFAULT_TITLE_SLUG,
          locationRaw,
          listDescription,
          listCitySlug,
          employmentTypeRaw,
          postedAt: row.date_added ?? row.date_updated ?? row.date_new ?? null,
        });
        seen.add(guid);
      }

      if (!payload.pagination?.has_more_pages) break;
    }

    if (stubs.length === 0) {
      throw new Error("jobsyn: no jobs discovered from list endpoint");
    }

    const existingByEid =
      env?.JOBS_DB && stubs.length > 0
        ? await batchGetExistingJobs(env.JOBS_DB, source.id, stubs.map((s) => s.guid))
        : new Map();

    const toEnrich: number[] = [];
    for (let i = 0; i < stubs.length; i++) {
      const s = stubs[i]!;
      const stored = existingByEid.get(s.guid)?.description_raw ?? null;
      if (stored && isSubstantive(stored)) continue;
      if (isSubstantive(s.listDescription)) continue;
      toEnrich.push(i);
    }

    const detailResults = await mapWithConcurrency(toEnrich, DETAIL_FETCH_CONCURRENCY, async (idx) => {
      const guid = stubs[idx]!.guid;
      return { idx, detail: await fetchDetail(guid) };
    });

    const detailsByIdx = new Map<number, JobsynDetail>();
    for (const { idx, detail } of detailResults) {
      if (detail) detailsByIdx.set(idx, detail);
    }

    const out: NormalizedJob[] = [];
    const nowSec = Math.floor(Date.now() / 1000);

    for (let i = 0; i < stubs.length; i++) {
      const stub = stubs[i]!;
      const detail = detailsByIdx.get(i) ?? null;
      const stored = existingByEid.get(stub.guid)?.description_raw ?? null;
      const title = String(detail?.title_exact ?? detail?.title ?? stub.title).trim() || stub.title;
      const locationRaw = normalizeLocation(
        detail?.location_exact ??
          detail?.location ??
          stub.locationRaw ??
          "United States"
      );
      const posted = parseEpochSeconds(detail?.date_added ?? detail?.date_updated ?? detail?.date_new ?? stub.postedAt);
      const employmentRaw = detail?.job_type ?? detail?.job_shift ?? stub.employmentTypeRaw;
      const employmentType = listEmploymentType(employmentRaw);
      const citySlug = detail ? pickDetailCitySlug(detail) : stub.listCitySlug;
      const detailTitleSlug = detail?.title_slug ? toSlug(detail.title_slug) : "";
      const titleSlug = detailTitleSlug || stub.titleSlug || DEFAULT_TITLE_SLUG;
      const applyUrl = buildApplyUrl(stub.guid, citySlug, titleSlug, template);
      const detailDesc = parseText(detail?.html_description ?? detail?.description ?? null);
      const listDesc = stub.listDescription;
      const description =
        stored && isSubstantive(stored)
          ? stored
          : isSubstantive(detailDesc)
            ? detailDesc
            : listDesc ?? "Description unavailable at ingest time.";

      out.push({
        external_id: stub.guid,
        title,
        location: locationRaw,
        employment_type: employmentType,
        workplace_type: normalizeWorkplaceType(detail?.job_shift ?? stub.employmentTypeRaw, locationRaw),
        apply_url: applyUrl,
        source_url: applyUrl,
        description_raw: description,
        salary_min: null,
        salary_max: null,
        salary_currency: null,
        salary_period: null,
        posted_at: posted ?? nowSec,
        company_name: String(detail?.company_exact ?? "Pearson").trim(),
        company_logo_url: null,
        company_website_url: null,
      });
    }

    return out;
  },
};
