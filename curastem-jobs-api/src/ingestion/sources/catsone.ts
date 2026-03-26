/**
 * CATS One career portals (`{tenant}.catsone.com/careers/...`).
 *
 * Department listing pages link to per-job URLs; each job page embeds schema.org
 * `JobPosting` JSON-LD **and** a `window.__PRELOADED_STATE__` blob with richer fields
 * (`remoteType`, `category`, engagement `type`, optional `salary` / `maxRate`, longer HTML
 * `description`). We merge both — JSON-LD for interoperability, preloaded entities for
 * fields CATS often omits from schema.org.
 *
 * `base_url` is the department listing URL, e.g.
 * `https://sphereinc.catsone.com/careers/90438-General`
 * A full job URL (`.../jobs/{id}-{slug}`) is accepted and normalized to that listing path.
 */

import type { EmploymentType, JobSource, NormalizedJob, SalaryPeriod, SourceRow, WorkplaceType } from "../../types.ts";
import {
  normalizeEmploymentType,
  normalizeLocation,
  normalizeWorkplaceType,
  parseEpochSeconds,
} from "../../utils/normalize.ts";

const USER_AGENT = "Curastem-Jobs-Ingestion/1.0 (developers@curastem.org)";
const FETCH_CONCURRENCY = 8;

interface SchemaMonetaryAmount {
  "@type"?: string;
  currency?: string;
  value?:
    | {
        minValue?: number;
        maxValue?: number;
        value?: number;
        unitText?: string;
      }
    | number;
}

interface SchemaJobPosting {
  "@type"?: string | string[];
  title?: string;
  description?: string;
  identifier?: { value?: string | number; name?: string };
  datePosted?: string;
  employmentType?: string;
  jobLocation?: unknown;
  jobLocationType?: string;
  baseSalary?: SchemaMonetaryAmount;
  hiringOrganization?: { name?: string; sameAs?: string; logo?: string };
}

function isJobPostingType(t: unknown): boolean {
  if (t === "JobPosting") return true;
  if (Array.isArray(t)) {
    return t.some((x) => typeof x === "string" && /JobPosting$/i.test(x));
  }
  if (typeof t === "string" && (/schema\.org\/JobPosting$/i.test(t) || t.endsWith("/JobPosting"))) {
    return true;
  }
  return false;
}

function coerceJobPosting(data: unknown): SchemaJobPosting | null {
  if (!data || typeof data !== "object") return null;
  const o = data as SchemaJobPosting;
  if (isJobPostingType(o["@type"])) return o;

  const graph = (o as { "@graph"?: unknown[] })["@graph"];
  if (Array.isArray(graph)) {
    for (const item of graph) {
      const jp = coerceJobPosting(item);
      if (jp) return jp;
    }
  }
  return null;
}

function extractJobPostingJson(html: string): SchemaJobPosting | null {
  const re = /<script\b[^>]*\btype=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const raw = m[1]?.trim();
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as unknown;
      const jp = coerceJobPosting(parsed);
      if (jp?.title) return jp;
    } catch {
      /* try next block */
    }
  }
  return null;
}

function salaryPeriodFromUnit(unit: string | undefined): SalaryPeriod | null {
  if (!unit) return null;
  const u = unit.toUpperCase();
  if (u === "YEAR" || u === "YEARLY") return "year";
  if (u === "MONTH" || u === "MONTHLY") return "month";
  if (u === "HOUR" || u === "HOURLY") return "hour";
  return null;
}

function parseSalaryFields(bs: SchemaMonetaryAmount | undefined): {
  min: number | null;
  max: number | null;
  currency: string | null;
  period: SalaryPeriod | null;
} {
  if (!bs?.value) return { min: null, max: null, currency: null, period: null };
  const v = bs.value;
  if (typeof v === "number") {
    return { min: v, max: v, currency: bs.currency ?? null, period: null };
  }
  const minV = v.minValue ?? v.value ?? null;
  const maxV = v.maxValue ?? v.value ?? null;
  return {
    min: minV,
    max: maxV,
    currency: bs.currency ?? null,
    period: salaryPeriodFromUnit(v.unitText),
  };
}

function locationAndWorkplace(jp: SchemaJobPosting): { location: string | null; workplace: WorkplaceType | null } {
  if (jp.jobLocationType === "TELECOMMUTE") {
    return { location: normalizeLocation("Remote"), workplace: "remote" };
  }

  const loc = jp.jobLocation;
  if (!loc || typeof loc !== "object") {
    return { location: null, workplace: null };
  }

  const place = loc as { address?: Record<string, unknown> };
  const addr = place.address;
  if (!addr || typeof addr !== "object") {
    return { location: null, workplace: null };
  }

  const locality = addr.addressLocality;
  const region = addr.addressRegion;
  const country = addr.addressCountry;
  const parts = [locality, region, country]
    .map((x) => (typeof x === "string" ? x : null))
    .filter((x): x is string => Boolean(x?.trim()));
  if (parts.length === 0) {
    return { location: null, workplace: null };
  }

  const raw = parts.join(", ");
  return {
    location: normalizeLocation(raw),
    workplace: normalizeWorkplaceType("on-site", raw),
  };
}

function extractOgImage(html: string): string | null {
  const a = html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i);
  const b = html.match(/<meta\s+content=["']([^"']+)["']\s+property=["']og:image["']/i);
  const v = (a ?? b)?.[1]?.trim();
  return v && v.startsWith("http") ? v : null;
}

/** Embedded Redux state — `app.entities.jobs[jobId]` has CATS fields not always in JSON-LD. */
interface CatsJobEntity {
  id: number;
  datePosted?: string;
  dateCreated?: string;
  dateModified?: string;
  description?: string;
  category?: string;
  city?: string;
  state?: string;
  country?: string;
  postalCode?: string | null;
  type?: string;
  remoteType?: string;
  salary?: string;
  maxRate?: string;
  department?: string | null;
  branch?: string;
}

const ENGAGEMENT_LABELS: Record<string, string> = {
  H: "Direct hire",
  C: "Contract",
  C2H: "Contract to hire",
};

/**
 * Parse `window.__PRELOADED_STATE__ = {...}` as JSON (balanced braces, string-aware).
 */
function extractAssignmentJson(html: string, marker: string): unknown | null {
  const i = html.indexOf(marker);
  if (i === -1) return null;
  let start = i + marker.length;
  while (start < html.length && (html[start] === " " || html[start] === "\n" || html[start] === "\r")) start++;
  if (html[start] !== "{") return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  let quote = "";
  for (let j = start; j < html.length; j++) {
    const c = html[j];
    if (inStr) {
      if (esc) {
        esc = false;
        continue;
      }
      if (c === "\\") {
        esc = true;
        continue;
      }
      if (c === quote) inStr = false;
      continue;
    }
    if (c === '"' || c === "'") {
      inStr = true;
      quote = c;
      continue;
    }
    if (c === "{") depth++;
    if (c === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(start, j + 1)) as unknown;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function extractPreloadedState(html: string): unknown | null {
  return extractAssignmentJson(html, "window.__PRELOADED_STATE__ = ");
}

function getCatsJobEntity(state: unknown, externalId: string): CatsJobEntity | null {
  const jobs = (state as { app?: { entities?: { jobs?: Record<string, CatsJobEntity> } } })?.app?.entities?.jobs;
  if (!jobs || typeof jobs !== "object") return null;
  const e = jobs[externalId];
  return e && typeof e === "object" && typeof e.id === "number" ? e : null;
}

function readPortal(state: unknown): { logoUrl: string | null; website: string | null } {
  const p = (state as { app?: { portal?: { logoUrl?: string; website?: string } } })?.app?.portal;
  const logo = p?.logoUrl?.trim();
  const web = p?.website?.trim();
  return {
    logoUrl: logo && logo.startsWith("http") ? logo : null,
    website: web ? (web.startsWith("http") ? web : `https://${web}`) : null,
  };
}

/** CATS `type`: H = direct hire, C / C2H = contract or contract-to-hire (maps to `contract`). */
function mapCatsEngagementType(t: string | undefined): EmploymentType | null {
  if (!t) return null;
  switch (t.toUpperCase()) {
    case "H":
      return "full_time";
    case "C":
    case "C2H":
      return "contract";
    default:
      return null;
  }
}

function workplaceFromCatsEntity(entity: CatsJobEntity | null): WorkplaceType | null {
  if (!entity) return null;
  const rt = (entity.remoteType ?? "").toLowerCase();
  if (rt.includes("remote")) return "remote";
  if (rt.includes("hybrid")) return "hybrid";
  if (rt.includes("on-site") || rt.includes("onsite")) return "on_site";
  return null;
}

function locationFromCatsEntity(entity: CatsJobEntity | null): string | null {
  if (!entity) return null;
  const rt = (entity.remoteType ?? "").toLowerCase();
  if (rt.includes("remote")) {
    return normalizeLocation("Remote");
  }
  const parts = [entity.city, entity.state, entity.country].filter((x): x is string => Boolean(x?.trim()));
  if (parts.length === 0) return null;
  const raw = parts.join(", ");
  const compact = raw.toLowerCase().replace(/\s+/g, "");
  if (compact === "usa,usa" || compact === "usa") {
    return null;
  }
  return normalizeLocation(raw);
}

function escapeHtmlText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function catsMetaPrefixHtml(entity: CatsJobEntity | null): string | null {
  if (!entity) return null;
  const bits: string[] = [];
  if (entity.category?.trim()) {
    bits.push(`<strong>Category:</strong> ${escapeHtmlText(entity.category.trim())}`);
  }
  const eng = entity.type?.trim();
  if (eng) {
    const label = ENGAGEMENT_LABELS[eng];
    bits.push(
      label
        ? `<strong>Engagement:</strong> ${escapeHtmlText(label)} (${escapeHtmlText(eng)})`
        : `<strong>Engagement:</strong> ${escapeHtmlText(eng)}`
    );
  }
  if (entity.remoteType?.trim()) {
    bits.push(`<strong>Remote:</strong> ${escapeHtmlText(entity.remoteType.trim())}`);
  }
  if (entity.department?.trim()) {
    bits.push(`<strong>Department:</strong> ${escapeHtmlText(entity.department.trim())}`);
  }
  if (entity.branch?.trim()) {
    bits.push(`<strong>Branch:</strong> ${escapeHtmlText(entity.branch.trim())}`);
  }
  if (bits.length === 0) return null;
  return `<p>${bits.join(" · ")}</p>`;
}

function mergeCatsDescription(
  ld: string | null,
  entity: CatsJobEntity | null,
  metaHtml: string | null
): string | null {
  const a = ld?.trim() ?? "";
  const b = entity?.description?.trim() ?? "";
  const body = b.length > a.length ? b : a || b;
  const parts = [metaHtml, body].filter((x): x is string => Boolean(x?.trim()));
  return parts.length ? parts.join("\n\n") : null;
}

/**
 * CATS `salary` is often a range string (e.g. `6000-6500`) without currency; infer period heuristically.
 */
function parseCatsSalaryString(raw: string | undefined): Pick<
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
  if (!raw?.trim()) return out;
  const t = raw.trim();
  const range = t.match(/^(\d[\d,]*)\s*-\s*(\d[\d,]*)$/);
  if (!range) return out;
  const min = parseInt(range[1].replace(/,/g, ""), 10);
  const max = parseInt(range[2].replace(/,/g, ""), 10);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return out;
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  out.salary_min = lo;
  out.salary_max = hi;
  out.salary_currency = "USD";
  if (hi >= 50_000) out.salary_period = "year";
  else if (hi >= 500 && hi < 50_000) out.salary_period = "month";
  else out.salary_period = "hour";
  return out;
}

function parseCatsOneBase(input: string): { origin: string; listingPath: string } {
  const u = new URL(input.trim());
  if (!u.hostname.toLowerCase().endsWith(".catsone.com")) {
    throw new Error(`catsone base_url must be *.catsone.com, got ${input}`);
  }
  const parts = u.pathname.replace(/\/$/, "").split("/").filter((p) => p.length > 0);
  const careersIdx = parts.indexOf("careers");
  if (careersIdx === -1 || parts.length < careersIdx + 2) {
    throw new Error(`catsone base_url must include /careers/{departmentSegment}, got ${input}`);
  }
  const jobsIdx = parts.indexOf("jobs");
  const end = jobsIdx !== -1 ? jobsIdx : parts.length;
  const listingSegments = parts.slice(0, end);
  const listingPath = `/${listingSegments.join("/")}`;
  return { origin: `${u.protocol}//${u.host}`, listingPath };
}

function collectJobPaths(html: string, listingPath: string): string[] {
  const escaped = listingPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`href=["'](${escaped}/jobs/\\d+[^"']*)["']`, "gi");
  const out = new Set<string>();
  for (const m of html.matchAll(re)) {
    out.add(m[1]);
  }
  return [...out];
}

async function fetchText(url: string): Promise<string | null> {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml" },
    redirect: "follow",
  });
  if (!res.ok) return null;
  return res.text();
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

export const catsoneFetcher: JobSource = {
  sourceType: "catsone",

  async fetch(source: SourceRow): Promise<NormalizedJob[]> {
    const { origin, listingPath } = parseCatsOneBase(source.base_url);
    const listingUrl = `${origin}${listingPath}`;

    const listHtml = await fetchText(listingUrl);
    if (!listHtml) {
      throw new Error(`catsone: failed to load listing HTML (${source.company_handle})`);
    }

    const paths = collectJobPaths(listHtml, listingPath);
    if (paths.length === 0) {
      throw new Error(`catsone: no job links under ${listingPath} (${source.company_handle})`);
    }

    const defaultCompany =
      source.name.replace(/\s*\(CATS(?:\s+One)?\)\s*/i, "").trim() || source.company_handle;

    const rows = await parallelMap(paths, FETCH_CONCURRENCY, async (path) => {
      const jobUrl = `${origin}${path}`;
      const html = await fetchText(jobUrl);
      if (!html) return null;
      const jp = extractJobPostingJson(html);
      if (!jp?.title?.trim()) return null;

      const ext =
        jp.identifier?.value !== undefined && jp.identifier?.value !== null
          ? String(jp.identifier.value)
          : path.replace(/^.*\/jobs\//, "").replace(/-.*/, "");

      const preloaded = extractPreloadedState(html);
      const entity = preloaded ? getCatsJobEntity(preloaded, ext) : null;
      const portal = preloaded ? readPortal(preloaded) : { logoUrl: null, website: null };

      const { location: locStr, workplace: wpDirect } = locationAndWorkplace(jp);

      const postedAt =
        (entity?.datePosted ? parseEpochSeconds(entity.datePosted) : null) ??
        (jp.datePosted ? parseEpochSeconds(jp.datePosted) : null);

      const ldSalary = parseSalaryFields(jp.baseSalary);
      const entitySalary = parseCatsSalaryString(entity?.salary || entity?.maxRate);
      const hasLdSalary = ldSalary.min != null || ldSalary.max != null;
      const salaryMin = hasLdSalary ? ldSalary.min : entitySalary.salary_min;
      const salaryMax = hasLdSalary ? ldSalary.max : entitySalary.salary_max;
      const salaryCurrency = hasLdSalary ? ldSalary.currency : entitySalary.salary_currency;
      const salaryPeriod = hasLdSalary ? ldSalary.period : entitySalary.salary_period;

      const org = jp.hiringOrganization;
      let website: string | undefined;
      if (org?.sameAs) {
        const s = String(org.sameAs).trim();
        if (s) website = s.startsWith("http") ? s : `https://${s}`;
      }
      if (!website?.trim() && portal.website) {
        website = portal.website;
      }

      const logoFromOrg =
        typeof org?.logo === "string" && org.logo.startsWith("http") ? org.logo : null;
      const logo = logoFromOrg ?? extractOgImage(html) ?? portal.logoUrl;

      const locMerged = locationFromCatsEntity(entity) ?? locStr;
      const workplace =
        workplaceFromCatsEntity(entity) ??
        wpDirect ??
        normalizeWorkplaceType(jp.jobLocationType === "TELECOMMUTE" ? "remote" : null, locMerged ?? "") ??
        normalizeWorkplaceType(null, jp.title);

      const employment =
        normalizeEmploymentType(jp.employmentType ?? null) ?? mapCatsEngagementType(entity?.type);

      const metaHtml = catsMetaPrefixHtml(entity);
      const descriptionRaw = mergeCatsDescription(jp.description ?? null, entity, metaHtml);

      const companyName = org?.name?.trim() || defaultCompany;

      const row: NormalizedJob = {
        external_id: ext,
        title: jp.title.trim(),
        location: locMerged,
        employment_type: employment,
        workplace_type: workplace,
        apply_url: jobUrl,
        source_url: jobUrl,
        description_raw: descriptionRaw,
        salary_min: salaryMin,
        salary_max: salaryMax,
        salary_currency: salaryCurrency,
        salary_period: salaryPeriod,
        posted_at: postedAt,
        company_name: companyName,
        company_website_url: website ?? null,
        company_logo_url: logo,
      };
      return row;
    });

    const ok = rows.filter((j): j is NormalizedJob => j !== null);
    if (ok.length === 0 && paths.length > 0) {
      throw new Error(`catsone: ${paths.length} job link(s) but 0 JobPosting JSON-LD parses (${source.company_handle})`);
    }
    return ok;
  },
};
