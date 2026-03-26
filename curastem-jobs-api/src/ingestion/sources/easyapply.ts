/**
 * EasyApply (gethired.com / easyapply.co) tenant boards.
 *
 * Tenant homepages list roles (various href shapes); each job page embeds schema.org
 * JobPosting JSON-LD (plain HTML — no JS required).
 *
 * `base_url` is the tenant site root, e.g. `https://snaplii.easyapply.co/`
 */

import type { JobSource, NormalizedJob, SalaryPeriod, SourceRow, WorkplaceType } from "../../types.ts";
import {
  normalizeEmploymentType,
  normalizeLocation,
  normalizeWorkplaceType,
  parseEpochSeconds,
} from "../../utils/normalize.ts";

const USER_AGENT = "Curastem-Jobs-Ingestion/1.0 (developers@curastem.org)";

/** Collect slugs from index HTML — EasyApply has used apex links, tenant links, and relative /job/ paths. */
function collectJobSlugs(indexHtml: string, tenantHost: string): string[] {
  const slugs = new Set<string>();
  const patterns: RegExp[] = [
    /https?:\/\/easyapply\.co\/job\/([a-zA-Z0-9\-]+)/gi,
    new RegExp(`https?:\\/\\/${escapeRegex(tenantHost)}\\/job\\/([a-zA-Z0-9\\-]+)`, "gi"),
    /href=["']\/job\/([a-zA-Z0-9\-]+)["']/gi,
    /\/\/easyapply\.co\/job\/([a-zA-Z0-9\-]+)/gi,
  ];
  for (const re of patterns) {
    for (const m of indexHtml.matchAll(re)) {
      slugs.add(m[1]);
    }
  }
  return [...slugs];
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

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
  identifier?: { value?: string | number };
  datePosted?: string;
  employmentType?: string;
  jobLocation?: unknown;
  jobLocationType?: string;
  baseSalary?: SchemaMonetaryAmount;
  hiringOrganization?: { name?: string; sameAs?: string };
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

/**
 * Walk every `application/ld+json` block — some tenants use multiple scripts or `@graph`.
 * Tag may include extra attributes (e.g. `nonce`) before the closing `>`.
 */
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

  const place = loc as { address?: Record<string, string> };
  const addr = place.address;
  if (!addr || typeof addr !== "object") {
    return { location: null, workplace: null };
  }

  const locality = addr.addressLocality;
  const region = addr.addressRegion;
  const country = addr.addressCountry;
  const parts = [locality, region, country].filter((x): x is string => Boolean(x?.trim()));
  if (parts.length === 0) {
    return { location: null, workplace: null };
  }

  const raw = parts.join(", ");
  return {
    location: normalizeLocation(raw),
    workplace: normalizeWorkplaceType("on-site", raw),
  };
}

export const easyapplyFetcher: JobSource = {
  sourceType: "easyapply",

  async fetch(source: SourceRow): Promise<NormalizedJob[]> {
    const root = new URL(source.base_url);
    if (!/\.easyapply\.co$/i.test(root.hostname)) {
      throw new Error(`easyapply base_url must be a *.easyapply.co origin, got ${source.base_url}`);
    }
    const origin = `${root.protocol}//${root.host}`;
    const tenantHost = root.host;

    const indexRes = await fetch(source.base_url, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
    });
    if (!indexRes.ok) {
      throw new Error(`EasyApply index HTTP ${indexRes.status} (${source.company_handle})`);
    }
    const indexHtml = await indexRes.text();
    const slugs = collectJobSlugs(indexHtml, tenantHost);
    if (slugs.length === 0) {
      throw new Error(`No /job/ links found on EasyApply index (${source.company_handle})`);
    }

    const companyName =
      source.name.replace(/\s*\(EasyApply\)\s*/i, "").trim() || source.company_handle;
    const jobs: NormalizedJob[] = [];

    for (const slug of slugs) {
      const jobUrl = `${origin}/job/${slug}`;
      try {
        const res = await fetch(jobUrl, {
          headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
        });
        if (!res.ok) continue;
        const html = await res.text();
        const jp = extractJobPostingJson(html);
        if (!jp?.title) continue;

        const ext =
          jp.identifier?.value !== undefined && jp.identifier?.value !== null
            ? String(jp.identifier.value)
            : slug;

        const { location: locStr, workplace: wpDirect } = locationAndWorkplace(jp);
        const postedAt = jp.datePosted ? parseEpochSeconds(jp.datePosted) : null;

        const { min: salaryMin, max: salaryMax, currency: salaryCurrency, period: salaryPeriod } =
          parseSalaryFields(jp.baseSalary);

        const org = jp.hiringOrganization;
        let website: string | undefined;
        if (org?.sameAs) {
          const s = org.sameAs.trim();
          website = s.startsWith("http") ? s : `https://${s}`;
        }

        const workplace =
          wpDirect ??
          normalizeWorkplaceType(jp.jobLocationType === "TELECOMMUTE" ? "remote" : null, locStr ?? "");

        jobs.push({
          external_id: ext,
          title: jp.title,
          location: locStr,
          employment_type: normalizeEmploymentType(jp.employmentType ?? null),
          workplace_type: workplace,
          apply_url: jobUrl,
          source_url: jobUrl,
          description_raw: jp.description ?? null,
          salary_min: salaryMin,
          salary_max: salaryMax,
          salary_currency: salaryCurrency,
          salary_period: salaryPeriod,
          posted_at: postedAt,
          company_name: companyName,
          company_website_url: website,
        });
      } catch {
        continue;
      }
    }

    if (jobs.length === 0 && slugs.length > 0) {
      throw new Error(
        `EasyApply: ${slugs.length} job link(s) on index but 0 valid JobPosting JSON-LD payloads (${source.company_handle})`
      );
    }

    return jobs;
  },
};
