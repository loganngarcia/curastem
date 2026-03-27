/**
 * Thanks for using Curastem! Curastem is a 501(c)(3) non-profit dedicated to connecting
 * high-quality talent with job opportunities. Our mission is to serve underserved job
 * applicants and support local communities. Consider joining us on this mission. Questions?
 * Contact developers@curastem.org
 *
 * Rippling Recruiting public job boards (`ats.rippling.com/{slug}/jobs`).
 *
 * Listings and job pages embed Next.js `__NEXT_DATA__` (SSR) with job metadata and HTML
 * descriptions — no authenticated API required.
 *
 * Extracted from `props.pageProps.apiData` and the listing query: `jobPost` (title, HTML
 * descriptions, employment type, `createdOn`, company), top-level `workLocations`,
 * `payRangeDetails` (salary when present), `department` (prepended to `description_raw`),
 * board logos; listing rows add structured `locations` and `workplaceType` when detail
 * strings alone are ambiguous.
 *
 * `base_url` is the board root, e.g. `https://ats.rippling.com/patientnow/jobs`.
 * A full job URL (`.../jobs/{uuid}`) is accepted and normalized to the board root.
 */

import type {
  EmploymentType,
  JobSource,
  NormalizedJob,
  SalaryPeriod,
  SourceRow,
  WorkplaceType,
} from "../../types.ts";
import { normalizeLocation, normalizeWorkplaceType, parseEpochSeconds } from "../../utils/normalize.ts";

const USER_AGENT = "Curastem-Jobs-Ingestion/1.0 (developers@curastem.org)";

const DETAIL_CONCURRENCY = 10;

interface RipplingListLocation {
  name?: string;
  country?: string;
  city?: string;
  state?: string;
  workplaceType?: string;
}

interface RipplingListItem {
  id: string;
  name: string;
  url: string;
  department?: { name?: string };
  locations?: RipplingListLocation[];
  /** BCP 47 tag from the listing query (e.g. en-US). */
  language?: string;
}

interface RipplingDepartment {
  name?: string;
  base_department?: string;
  department_tree?: string[];
}

interface RipplingJobPost {
  uuid: string;
  name: string;
  url: string;
  companyName?: string;
  description?: { company?: string; role?: string };
  workLocations?: string[];
  department?: RipplingDepartment;
  employmentType?: { label?: string; id?: string };
  createdOn?: string;
  board?: { logo?: { url?: string }; boardURL?: string };
  payRangeDetails?: unknown[];
}

/** Top-level `pageProps.apiData` on job detail pages (fields may mirror `jobPost`). */
interface RipplingApiData {
  jobPost?: RipplingJobPost;
  jobBoard?: { logo?: { url?: string } };
  payRangeDetails?: unknown[];
  workLocations?: string[];
  department?: RipplingDepartment;
}

function parseBoardFromBaseUrl(input: string): { slug: string } {
  const u = new URL(input.trim());
  if (u.hostname !== "ats.rippling.com") {
    throw new Error(`rippling base_url must use host ats.rippling.com, got ${input}`);
  }
  const m = u.pathname.match(/^\/([^/]+)\/jobs(?:\/[^/]+)?\/?$/i);
  if (!m) {
    throw new Error(
      `rippling base_url must be https://ats.rippling.com/{slug}/jobs or a job URL under that path. Got ${input}`
    );
  }
  return { slug: m[1] };
}

async function fetchText(url: string): Promise<string | null> {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml" },
    redirect: "follow",
  });
  if (!res.ok) return null;
  return res.text();
}

function extractNextData(html: string): unknown | null {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

function extractJobListFromNextData(nextData: unknown): { items: RipplingListItem[]; totalPages: number } | null {
  const pp = (nextData as { props?: { pageProps?: { dehydratedState?: { queries?: unknown[] } } } })?.props
    ?.pageProps;
  const queries = pp?.dehydratedState?.queries;
  if (!Array.isArray(queries)) return null;
  for (const q of queries) {
    const key = (q as { queryKey?: unknown }).queryKey;
    if (key !== undefined && JSON.stringify(key).includes("job-posts")) {
      const data = (q as { state?: { data?: { items?: RipplingListItem[]; totalPages?: number } } }).state?.data;
      if (data?.items && Array.isArray(data.items)) {
        return { items: data.items, totalPages: data.totalPages ?? 1 };
      }
    }
  }
  return null;
}

async function fetchAllListItems(slug: string): Promise<RipplingListItem[]> {
  const origin = `https://ats.rippling.com/${slug}/jobs`;
  const firstHtml = await fetchText(origin);
  if (!firstHtml) {
    throw new Error(`rippling: failed to load job board HTML (${slug})`);
  }
  const firstNext = extractNextData(firstHtml);
  const firstList = firstNext ? extractJobListFromNextData(firstNext) : null;
  if (!firstList || firstList.items.length === 0) {
    throw new Error(`rippling: no jobs in __NEXT_DATA__ for board ${slug}`);
  }

  const { totalPages } = firstList;
  const all: RipplingListItem[] = [...firstList.items];

  for (let page = 1; page < totalPages; page++) {
    const pageUrl = `${origin}?page=${page}`;
    const html = await fetchText(pageUrl);
    if (!html) break;
    const next = extractNextData(html);
    const list = next ? extractJobListFromNextData(next) : null;
    if (list?.items?.length) all.push(...list.items);
  }

  const seen = new Set<string>();
  const deduped: RipplingListItem[] = [];
  for (const it of all) {
    if (seen.has(it.id)) continue;
    seen.add(it.id);
    deduped.push(it);
  }
  return deduped;
}

function mapEmployment(label: string | undefined): EmploymentType | null {
  if (!label) return null;
  const u = label.toUpperCase();
  if (u.includes("SALARIED_FT") || u.includes("FULL")) return "full_time";
  if (u.includes("SALARIED_PT") || u.includes("PART")) return "part_time";
  if (u.includes("HOURLY")) return u.includes("PT") ? "part_time" : "full_time";
  if (u.includes("CONTRACT")) return "contract";
  if (u.includes("INTERN")) return null; // internship is seniority_level, not employment_type
  if (u.includes("TEMP")) return "temporary";
  return null;
}

function workplaceFromRipplingStrings(workLocations: string[] | undefined): WorkplaceType | null {
  const locs = workLocations ?? [];
  const text = locs.join(" ").toLowerCase();
  if (text.includes("remote")) return "remote";
  if (text.includes("hybrid")) return "hybrid";
  if (locs.length > 0) return "on_site";
  return null;
}

/** Listing rows include structured `workplaceType` (REMOTE / HYBRID / ON_SITE) per location. */
function workplaceFromListLocations(locs: RipplingListLocation[] | undefined): WorkplaceType | null {
  const types = new Set((locs ?? []).map((l) => (l.workplaceType ?? "").toUpperCase()));
  if (types.has("REMOTE")) return "remote";
  if (types.has("HYBRID")) return "hybrid";
  if (types.has("ON_SITE") || types.has("ONSITE")) return "on_site";
  return null;
}

function locationStringFromMerged(jp: RipplingJobPost, apiData: RipplingApiData, listItem: RipplingListItem): string | null {
  const fromDetail = apiData.workLocations ?? jp.workLocations;
  if (fromDetail && fromDetail.length > 0) {
    const norm = fromDetail.map((x) => normalizeLocation(x)).filter((x): x is string => Boolean(x));
    if (norm.length) return norm.join("; ");
  }
  const fromList = (listItem.locations ?? [])
    .map((l) => {
      if (l.name?.trim()) return l.name.trim();
      const parts = [l.city, l.state, l.country].filter((x): x is string => Boolean(x?.trim()));
      return parts.length ? parts.join(", ") : "";
    })
    .filter(Boolean);
  const norm = fromList.map((x) => normalizeLocation(x)).filter((x): x is string => Boolean(x));
  return norm.length ? norm.join("; ") : null;
}

function departmentPrefixHtml(dept: RipplingDepartment | undefined): string | null {
  const name = dept?.name?.trim() || dept?.base_department?.trim();
  if (!name) return null;
  const esc = name.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<p><strong>Department:</strong> ${esc}</p>`;
}

function tryExtractMinMax(o: Record<string, unknown>): { min: number | null; max: number | null } {
  const pick = (k: string): number | null => {
    const v = o[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (v && typeof v === "object" && "amount" in (v as object)) {
      const inner = (v as { amount?: unknown }).amount;
      if (typeof inner === "number" && Number.isFinite(inner)) return inner;
      if (inner && typeof inner === "object" && "value" in (inner as object)) {
        const val = (inner as { value?: unknown }).value;
        if (typeof val === "number" && Number.isFinite(val)) return val;
      }
    }
    return null;
  };
  const pairs: [string, string][] = [
    ["minAmount", "maxAmount"],
    ["minimum", "maximum"],
    ["min", "max"],
    ["minPay", "maxPay"],
    ["salaryMin", "salaryMax"],
  ];
  for (const [a, b] of pairs) {
    const x = pick(a);
    const y = pick(b);
    if (x != null || y != null) return { min: x, max: y ?? x };
  }
  return { min: null, max: null };
}

function mapPayPeriod(raw: unknown): SalaryPeriod | null {
  const s = String(raw ?? "").toUpperCase();
  if (!s) return null;
  if (s.includes("YEAR") || s === "ANNUAL" || s.includes("PER_YEAR") || s === "SALARY") return "year";
  if (s.includes("HOUR")) return "hour";
  if (s.includes("MONTH")) return "month";
  return null;
}

/**
 * `payRangeDetails` shapes vary by tenant — extract min/max/currency/period defensively.
 */
function parseRipplingPayRange(raw: unknown): Pick<
  NormalizedJob,
  "salary_min" | "salary_max" | "salary_currency" | "salary_period"
> {
  const out: Pick<
    NormalizedJob,
    "salary_min" | "salary_max" | "salary_currency" | "salary_period"
  > = {
    salary_min: null,
    salary_max: null,
    salary_currency: null,
    salary_period: null,
  };
  if (!Array.isArray(raw) || raw.length === 0) return out;

  let globalMin: number | null = null;
  let globalMax: number | null = null;

  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const o = entry as Record<string, unknown>;
    const { min, max } = tryExtractMinMax(o);
    if (min == null && max == null) continue;
    const lo = min != null && max != null ? Math.min(min, max) : (min ?? max)!;
    const hi = min != null && max != null ? Math.max(min, max) : (max ?? min)!;
    globalMin = globalMin == null ? lo : Math.min(globalMin, lo);
    globalMax = globalMax == null ? hi : Math.max(globalMax, hi);

    if (!out.salary_currency) {
      const c = o.currency ?? o.currencyCode ?? o.isoCurrencyCode;
      if (typeof c === "string" && /^[A-Z]{3}$/i.test(c.trim())) {
        out.salary_currency = c.trim().toUpperCase();
      }
    }
    if (!out.salary_period) {
      const p = mapPayPeriod(o.payFrequency ?? o.payPeriod ?? o.frequency ?? o.period);
      if (p) out.salary_period = p;
    }
  }

  if (globalMin != null || globalMax != null) {
    out.salary_min = globalMin ?? globalMax;
    out.salary_max = globalMax ?? globalMin;
  }

  return out;
}

function jobPostToNormalized(apiData: RipplingApiData, listItem: RipplingListItem): NormalizedJob | null {
  const jp = apiData.jobPost;
  if (!jp?.uuid || !jp.name?.trim()) return null;

  const dept = jp.department ?? apiData.department ?? listItem.department;
  const deptPrefix = departmentPrefixHtml(dept);
  const bodyParts = [jp.description?.company, jp.description?.role].filter((x): x is string => Boolean(x?.trim()));
  const descriptionParts = [deptPrefix, ...bodyParts].filter((x): x is string => Boolean(x?.trim()));
  const descriptionRaw = descriptionParts.length > 0 ? descriptionParts.join("\n\n") : null;

  const locStr = locationStringFromMerged(jp, apiData, listItem);
  const workLocs = apiData.workLocations ?? jp.workLocations;
  const workplace =
    workplaceFromRipplingStrings(workLocs) ??
    workplaceFromListLocations(listItem.locations) ??
    normalizeWorkplaceType(null, locStr);

  const et = mapEmployment(jp.employmentType?.label ?? jp.employmentType?.id);
  const postedAt = jp.createdOn ? parseEpochSeconds(jp.createdOn) : null;

  const salary = parseRipplingPayRange(apiData.payRangeDetails ?? jp.payRangeDetails);

  const logoUrl = jp.board?.logo?.url ?? apiData.jobBoard?.logo?.url;
  const logo =
    typeof logoUrl === "string" && logoUrl.startsWith("http") ? logoUrl : null;

  return {
    external_id: jp.uuid,
    title: jp.name.trim(),
    location: locStr,
    employment_type: et,
    workplace_type: workplace,
    apply_url: jp.url,
    source_url: jp.url,
    description_raw: descriptionRaw,
    salary_min: salary.salary_min,
    salary_max: salary.salary_max,
    salary_currency: salary.salary_currency,
    salary_period: salary.salary_period,
    posted_at: postedAt,
    company_name: jp.companyName?.trim() || "Unknown",
    company_logo_url: logo,
  };
}

async function parallelMap<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

export const ripplingFetcher: JobSource = {
  sourceType: "rippling",

  async fetch(source: SourceRow): Promise<NormalizedJob[]> {
    const { slug } = parseBoardFromBaseUrl(source.base_url);
    const listItems = await fetchAllListItems(slug);

    const jobs = await parallelMap(listItems, DETAIL_CONCURRENCY, async (item) => {
      const html = await fetchText(item.url);
      if (!html) return null;
      const next = extractNextData(html);
      const apiData = (next as { props?: { pageProps?: { apiData?: RipplingApiData } } })?.props?.pageProps
        ?.apiData;
      if (!apiData?.jobPost) return null;
      const row = jobPostToNormalized(apiData, item);
      if (!row) return null;
      if (source.name && !source.name.includes("Unknown")) {
        const shortName = source.name.replace(/\s*\(Rippling\)\s*/i, "").trim();
        if (shortName && row.company_name === "Unknown") row.company_name = shortName;
      }
      return row;
    });

    const ok = jobs.filter((j): j is NormalizedJob => j !== null);
    if (ok.length === 0 && listItems.length > 0) {
      throw new Error(
        `rippling: ${listItems.length} listing row(s) but 0 job detail payloads parsed (${source.company_handle})`
      );
    }
    return ok;
  },
};
