/**
 * Paycor career sites (`*.paycor.com/career/...`) with server-rendered job pages.
 *
 * Wingstop and similar hosts expose job listings as:
 * - list links in `a[href="...JobIntroduction.action?...id=..."]`
 * - per-job detail pages with full visible job text (including description) in HTML.
 * `base_url` should be the customer-facing careers root that serves the listing page,
 * for example `https://careerswingstop.com/`.
 */

import type { EmploymentType, JobSource, NormalizedJob, SourceRow } from "../../types.ts";
import {
  htmlToText,
  normalizeEmploymentType,
  normalizeLocation,
  normalizeWorkplaceType,
} from "../../utils/normalize.ts";

const USER_AGENT = "Curastem-Jobs-Ingestion/1.0 (developers@curastem.org)";
const DETAIL_FETCH_CONCURRENCY = 10;

const LISTING_ROW_RE =
  /<div class="gnewtonCareerGroupJobTitleClass">\s*<a[^>]*href="([^"]*JobIntroduction\.action[^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<div class="gnewtonCareerGroupJobDescriptionClass">\s*([\s\S]*?)<\/div>/gi;

interface PaycorListing {
  externalId: string;
  title: string;
  location: string;
  detailUrl: string;
}

interface PaycorDetail {
  descriptionRaw: string | null;
  employmentType: EmploymentType | null;
  applyUrl: string | null;
}

function sanitizeText(raw: string): string {
  return raw
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ")
    .trim();
}

function extractListingRows(html: string, origin: string): PaycorListing[] {
  const seen = new Set<string>();
  const out: PaycorListing[] = [];
  LISTING_ROW_RE.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = LISTING_ROW_RE.exec(html)) !== null) {
    const rawHref = match[1];
    const rawTitle = match[2];
    const rawLocation = match[3];

    if (!rawHref || !rawTitle) continue;

    const detailUrl = new URL(rawHref, origin).toString();
    const externalId = (() => {
      try {
        return new URL(detailUrl).searchParams.get("id");
      } catch {
        return null;
      }
    })();
    if (!externalId || seen.has(externalId)) continue;
    seen.add(externalId);

    const title = sanitizeText(rawTitle);
    const location = sanitizeText(rawLocation);
    if (!title) continue;

    out.push({
      externalId,
      detailUrl,
      title,
      location,
    });
  }

  return out;
}

function stripNoContentSections(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "");
}

function toLines(html: string): string[] {
  const cleanBody = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? html;
  const plain = htmlToText(stripNoContentSections(cleanBody));
  return plain
    .replace(/\u00a0/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function findLine(lines: string[], pattern: RegExp | string): number {
  const matcher = typeof pattern === "string"
    ? (value: string) => value.toLowerCase() === pattern.toLowerCase()
    : (value: string) => pattern.test(value);
  return lines.findIndex((value) => matcher(value));
}

function inferEmploymentFromText(raw: string): EmploymentType | null {
  const text = raw.toLowerCase();
  if (text.includes("part time") || text.includes("part-time") || text.includes("parttime")) return "part_time";
  if (text.includes("contract")) return "contract";
  if (text.includes("temporary") || /\btemp\b/.test(text)) return "temporary";
  if (text.includes("volunteer")) return "volunteer";
  if (text.includes("full time") || text.includes("full-time") || text.includes("fulltime")) return "full_time";
  return null;
}

function normalizeDescriptionLines(lines: string[]): string {
  return lines
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

function parseDetailPage(html: string, listing: PaycorListing): PaycorDetail {
  const formMatch = html.match(
    /<form[^>]*action="([^"]*SubmitResume\.action[^"]+)"[^>]*>/i
  );
  const applyUrl = formMatch?.[1] ? new URL(formMatch[1], listing.detailUrl).toString() : null;

  const lines = toLines(html);
  const rawPositionLine = findLine(lines, /^Position:$/i);
  const openingsLine = findLine(lines, /^# of Openings:?$/i);
  const qualificationsLine = findLine(lines, /Qualifications\/\s*Education\/\s*Experience:/i);
  const responsibilitiesLine = findLine(lines, /Summary of Key Responsibilities/i);
  const descriptionLine = Math.min(
    qualificationsLine >= 0 ? qualificationsLine : Number.MAX_SAFE_INTEGER,
    responsibilitiesLine >= 0 ? responsibilitiesLine : Number.MAX_SAFE_INTEGER,
  );

  const title = rawPositionLine >= 0 && lines[rawPositionLine + 1]
    ? lines[rawPositionLine + 1]
    : listing.title;
  let descriptionStart = openingsLine >= 0
    ? Math.max(openingsLine + 3, 0)
    : rawPositionLine >= 0
      ? Math.max(rawPositionLine + 3, 0)
      : 0;
  if (descriptionLine < Number.MAX_SAFE_INTEGER) {
    descriptionStart = descriptionLine;
  }

  const descriptionLines = lines.slice(Math.max(0, descriptionStart));
  const filteredDescription = descriptionLines.filter((line) => line !== title && line !== listing.location);
  const descriptionRaw = normalizeDescriptionLines(filteredDescription);
  const employmentType = normalizeEmploymentType(
    [title, listing.location, descriptionRaw].filter(Boolean).join(" ")
  ) ?? inferEmploymentFromText(`${title}\n${listing.location}\n${descriptionRaw}`);

  return {
    descriptionRaw: descriptionRaw || null,
    employmentType,
    applyUrl,
  };
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += limit) {
    const chunk = items.slice(i, i + limit);
    out.push(...(await Promise.all(chunk.map((item) => fn(item)))));
  }
  return out;
}

export const paycorFetcher: JobSource = {
  sourceType: "paycor",

  async fetch(source: SourceRow): Promise<NormalizedJob[]> {
    const listingUrl = source.base_url.trim();
    const companyName = source.name.replace(/\s*\([^)]*paycor[^)]*\)\s*/i, "").trim();

    const listRes = await fetch(listingUrl, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html",
      },
    });
    if (!listRes.ok) {
      throw new Error(`Paycor listing fetch failed (${listRes.status}) for ${source.company_handle}`);
    }

    const listingHtml = await listRes.text();
    const listings = extractListingRows(listingHtml, listingUrl);
    if (listings.length === 0) return [];

    const details = await mapWithConcurrency(
      listings,
      DETAIL_FETCH_CONCURRENCY,
      async (listing) => {
        const detailRes = await fetch(listing.detailUrl, {
          headers: {
            "User-Agent": USER_AGENT,
            Accept: "text/html",
          },
        });
        if (!detailRes.ok) {
          return {
            ...listing,
            descriptionRaw: null,
            employmentType: null,
            applyUrl: null,
          } as PaycorListing & PaycorDetail;
        }
        const detailHtml = await detailRes.text();
        return {
          ...listing,
          ...parseDetailPage(detailHtml, listing),
        };
      },
    );

    return details.map((job) => {
      const normalizedLocation = normalizeLocation(job.location, source.company_handle);
      const descriptionRaw = job.descriptionRaw ?? null;
      return {
        external_id: job.externalId,
        title: job.title,
        location: normalizedLocation,
        employment_type: job.employmentType,
        workplace_type: normalizeWorkplaceType(null, normalizedLocation),
        apply_url: job.applyUrl ?? job.detailUrl,
        source_url: job.detailUrl,
        description_raw: descriptionRaw,
        salary_min: null,
        salary_max: null,
        salary_currency: null,
        salary_period: null,
        posted_at: null,
        company_name: companyName,
      };
    });
  },
};
