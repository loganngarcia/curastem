/**
 * AppOne (myStaffingPro) career portals with ASP.NET Web Forms search + detail pages.
 *
 * Many AppOne boards expose `Search.aspx` HTML pages that require posted form fields
 * (`__VIEWSTATE`, `__EVENTVALIDATION`, etc.) and `__EVENTTARGET` for pagination.
 * Job cards then link to per-role `MainInfoReq.asp` pages where details are rendered
 * as plain HTML tables.
 */

import type { EmploymentType, JobSource, NormalizedJob, SourceRow } from "../../types.ts";
import {
  extractSalaryFromText,
  htmlToText,
  normalizeEmploymentType,
  normalizeLocation,
  normalizeWorkplaceType,
  parseEpochSeconds,
} from "../../utils/normalize.ts";

const USER_AGENT = "Curastem-Jobs-Ingestion/1.0 (developers@curastem.org)";
const LISTING_CONCURRENCY = 8;

const MAX_PAGES = 20;
const NEXT_BUTTON_NAME = "ctl00$cphBody$btnPageNext";
const SEARCH_BUTTON_NAME = "ctl00$cphBody$btnSearch";
const KEYWORD_NAME = "ctl00$cphBody$txtKeyword";
const MIN_SUBSTANTIVE_DESCRIPTION = 120;

interface AppOneListing {
  sourceUrl: string;
  detailUrl: string;
  externalId: string;
  title: string;
}

interface AppOneDetail {
  title: string | null;
  location: string | null;
  postedAt: number | null;
  employmentType: EmploymentType | null;
  salaryText: string | null;
  description: string | null;
  applyUrl: string | null;
}

interface FormFields {
  [name: string]: string;
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function cleanCellText(raw: string): string {
  return compactWhitespace(htmlToText(raw).replace(/\xa0/g, " "));
}

function extractApplyUrl(html: string, fallbackBase: string): string | null {
  const formMatch = html.match(/<form\b[^>]*\baction\s*=\s*(["'])(.*?)\1/i);
  if (formMatch?.[2]) {
    try {
      return new URL(decodeHtml(formMatch[2]), fallbackBase).toString();
    } catch {
      // keep searching
    }
  }

  const anchorMatch = html.match(
    /<a\b[^>]*\bhref\s*=\s*(["'])([^"']*Submit[^"']*|[^"']*Main\.asp[^"']*)\1/i,
  );
  if (anchorMatch?.[2]) {
    try {
      return new URL(decodeHtml(anchorMatch[2]), fallbackBase).toString();
    } catch {
      return null;
    }
  }

  return null;
}

function stripNoContentSections(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "");
}

function extractInputFields(html: string): FormFields {
  const fields: FormFields = {};
  const inputRe = /<input\b([^>]+)>/gi;
  const nameRe = /\bname\s*=\s*(["'])(.*?)\1/i;
  const valueRe = /\bvalue\s*=\s*(["'])(.*?)\1/i;

  let inputMatch: RegExpExecArray | null;
  while ((inputMatch = inputRe.exec(html)) !== null) {
    const attrs = inputMatch[1] ?? "";
    const nameMatch = nameRe.exec(attrs);
    const valueMatch = valueRe.exec(attrs);
    if (!nameMatch || !valueMatch) {
      continue;
    }

    const name = compactWhitespace(nameMatch[2] || "");
    const value = decodeHtml(valueMatch[2] || "");
    if (!name) continue;
    fields[name] = value;
  }

  return fields;
}

function extractHtmlAttribute(tag: string, attr: string): string | null {
  const re = new RegExp(`\\b${attr}\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s>]+))`, "i");
  const match = re.exec(tag);
  if (!match) return null;
  return decodeHtml(match[1] ?? match[2] ?? match[3] ?? "");
}

function extractLinksFromListing(html: string, baseUrl: string): AppOneListing[] {
  const out: AppOneListing[] = [];
  const seen = new Set<string>();

  const linkRe = /<a\b([^>]+)>/gi;
  let linkMatch: RegExpExecArray | null;
  while ((linkMatch = linkRe.exec(html)) !== null) {
    const attrs = linkMatch[1] ?? "";
    const href = extractHtmlAttribute(attrs, "href");
    if (!href) continue;
    if (!/MainInfoReq\.asp\b/i.test(href)) continue;

    try {
      const detailUrl = new URL(decodeHtml(href), baseUrl).toString();
      const parsed = new URL(detailUrl);
      const roleId = parsed.searchParams.get("R_ID");
      if (!roleId) continue;

      const sourceUrl = detailUrl;

      const title = (() => {
        const text = cleanCellText(extractInnerTextFromTag(linkMatch[0]));
        return text && text.length > 0 ? text : "Open Role";
      })();

      const loId = parsed.searchParams.get("Lo_ID");
      const fid = parsed.searchParams.get("FID");
      const searchScreenId = parsed.searchParams.get("SearchScreenID");
      const positionId = parsed.searchParams.get("PositionID");
      const externalId = [
        "r",
        roleId,
        loId,
        fid,
        searchScreenId,
        positionId,
      ]
        .filter(Boolean)
        .join("|");

      if (seen.has(externalId)) continue;
      seen.add(externalId);

      out.push({ sourceUrl, detailUrl, externalId, title });
    } catch {
      continue;
    }
  }

  return out;
}

function extractInnerTextFromTag(tag: string): string {
  const open = tag.indexOf(">");
  const close = tag.lastIndexOf("<");
  if (open === -1 || close <= open) return "";
  return tag.slice(open + 1, close);
}

function stripTableNoise(html: string): string {
  return stripNoContentSections(html).replace(/<hr\s*\/?>/gi, "\n");
}

function parseDescriptionRows(html: string): Record<string, string> {
  const table =
    html.match(/<table\b[^>]*id=["']JobDescription["'][\s\S]*?<\/table>/i)?.[0] ?? "";
  if (!table) return {};

  const labelsToValues: Record<string, string> = {};
  const rowRe = /<tr\b[^>]*>[\s\S]*?<td\b[^>]*>([\s\S]*?)<\/td>\s*<td\b[^>]*>([\s\S]*?)<\/td>[\s\S]*?<\/tr>/gi;

  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRe.exec(table)) !== null) {
    const rawLabel = cleanCellText(rowMatch[1] ?? "");
    const rawValue = cleanCellText(rowMatch[2] ?? "");
    if (!rawLabel || !rawValue) continue;
    const key = rawLabel.replace(/[^a-z0-9]+/gi, " ").trim().toLowerCase();
    if (!key) continue;
    labelsToValues[key] = rawValue;
  }

  return labelsToValues;
}

function findLabel(fields: Record<string, string>, key: string): string | null {
  return fields[key] ?? null;
}

function firstField(
  fields: Record<string, string>,
  keys: string[],
): string | null {
  for (const key of keys) {
    const value = fields[key];
    if (value && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function parsePostedAtFromFields(fields: Record<string, string>): number | null {
  const raw = firstField(fields, ["post date", "posted date", "date posted", "requisition date", "start date"]);
  return raw ? parseEpochSeconds(raw) : null;
}

function pickDescription(fields: Record<string, string>, tableHtml: string): string | null {
  const description = firstField(fields, [
    "description",
    "job description",
    "position description",
    "responsibilities",
    "duties",
  ]);
  if (description) return description;

  const anyNonBlank = Object.values(fields);
  if (anyNonBlank.length === 0) {
    return null;
  }

  const fallback = stripTableNoise(tableHtml)
    .replace(/<table\b[^>]*id=["']JobDescription["'][\s\S]*?<\/table>/gi, "")
    .trim();
  const fallbackText = cleanCellText(fallback);
  return fallbackText || null;
}

function parseDetailPage(html: string, listing: AppOneListing): AppOneDetail {
  const body = stripNoContentSections(html);
  const fields = parseDescriptionRows(body);
  const title = findLabel(fields, "title") ?? listing.title;
  const location = firstField(fields, ["location", "location address", "work location"]) ?? null;
  const salaryText = firstField(fields, ["pay range", "salary", "salary range"]) ?? null;
  const description = pickDescription(fields, body);
  const applyUrl = extractApplyUrl(body, listing.detailUrl);
  const etRaw = `${title || ""} ${location || ""} ${description || ""}`;
  const employmentType = normalizeEmploymentType(etRaw.toLowerCase());

  return {
    title: title ?? listing.title,
    location,
    postedAt: parsePostedAtFromFields(fields),
    employmentType,
    salaryText,
    description: description ?? null,
    applyUrl,
  };
}

function hasNextPage(html: string): boolean {
  if (!new RegExp(`name=["']${NEXT_BUTTON_NAME.replace(/\$/g, "\\$")}["']`, "i").test(html)) {
    return false;
  }
  return !/ctl00\$cphBody\$btnPageNext[^>]*\bdisabled\b/i.test(html);
}

async function fetchWithForm(url: string, fields: FormFields): Promise<string> {
  const body = new URLSearchParams(fields).toString();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html",
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      Origin: new URL(url).origin,
      Referer: url,
    },
    body,
  });
  if (!res.ok) {
    throw new Error(`AppOne listing POST failed (${res.status})`);
  }
  return res.text();
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;

  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return out;
}

export const apponeFetcher: JobSource = {
  sourceType: "appone",

  async fetch(source: SourceRow): Promise<NormalizedJob[]> {
    const listingUrl = source.base_url.trim();
    const companyName = source.name.replace(/\s*\([^)]*appone[^)]*\)\s*/i, "").trim();
    const now = Math.floor(Date.now() / 1000);

    const firstRes = await fetch(listingUrl, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html",
        Referer: listingUrl,
      },
    });
    if (!firstRes.ok) {
      throw new Error(`AppOne listing fetch failed (${firstRes.status}) for ${source.company_handle}`);
    }

    const firstHtml = await firstRes.text();
    const formFieldsBase = extractInputFields(firstHtml);
    formFieldsBase[KEYWORD_NAME] = "";
    formFieldsBase[SEARCH_BUTTON_NAME] = "Search for Jobs";

    const listings: AppOneListing[] = [];
    let formFields = formFieldsBase;
    let page = 0;

    while (page < MAX_PAGES) {
      const html = await fetchWithForm(listingUrl, formFields);
      const newRows = extractLinksFromListing(html, listingUrl);
      for (const row of newRows) {
        if (!listings.some((j) => j.detailUrl === row.detailUrl)) {
          listings.push(row);
        }
      }

      if (!hasNextPage(html)) {
        break;
      }

      page += 1;
      const nextState = extractInputFields(html);
      nextState["__EVENTTARGET"] = NEXT_BUTTON_NAME;
      nextState["__EVENTARGUMENT"] = "";
      formFields = nextState;
    }

    if (listings.length === 0) {
      return [];
    }

    const detailPages = await mapWithConcurrency(
      listings,
      LISTING_CONCURRENCY,
      async (listing) => {
        const res = await fetch(listing.detailUrl, {
          headers: {
            "User-Agent": USER_AGENT,
            Accept: "text/html",
            Referer: listingUrl,
          },
        });
        if (!res.ok) {
          return null;
        }

        const html = await res.text();
        const parsed = parseDetailPage(html, listing);
        return { listing, parsed };
      },
    );

    const jobs: NormalizedJob[] = [];
    for (const detailResult of detailPages) {
      if (!detailResult) continue;
      const { listing, parsed } = detailResult;
      const location = normalizeLocation(parsed.location || null, source.company_handle);
      const salary = parsed.salaryText ? extractSalaryFromText(parsed.salaryText) : null;
      const description = parsed.description ?? null;
      const applyUrl = parsed.applyUrl ?? listing.detailUrl;

      jobs.push({
        external_id: listing.externalId,
        title: parsed.title ?? listing.title,
        location,
        employment_type: parsed.employmentType,
        workplace_type: normalizeWorkplaceType(parsed.employmentType, location),
        apply_url: applyUrl,
        source_url: listing.sourceUrl,
        description_raw: description && description.length >= MIN_SUBSTANTIVE_DESCRIPTION ? description : null,
        salary_min: salary ? salary.min : null,
        salary_max: salary ? salary.max : null,
        salary_currency: salary ? salary.currency : null,
        salary_period: salary ? salary.period : null,
        posted_at: parsed.postedAt ?? now,
        company_name: companyName,
      });
    }

    return jobs;
  },
};
