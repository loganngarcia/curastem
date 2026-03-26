/**
 * Generic RSS job board fetcher.
 *
 * Job boards that expose RSS feeds (e.g. HigherEdJobs) can be ingested without
 * scraping. Standard RSS 2.0 format is supported. Google Jobs extensions
 * (`g:id`, `g:location`, `g:employer`) are read when present — used by SAP
 * SuccessFactors career sites whose `sitemap.xml` is a job RSS feed.
 *
 * Company name is taken from `g:employer` when present; otherwise extracted
 * from title or description; otherwise the source name is used.
 *
 * Uses regex parsing instead of DOMParser — Workers runtime lacks DOMParser.
 *
 * base_url must point to the RSS feed URL.
 * company_handle is used as a stable identifier (e.g. "higheredjobs").
 */

import type { JobSource, NormalizedJob, SourceRow } from "../../types.ts";
import {
  normalizeEmploymentType,
  normalizeLocation,
  normalizeWorkplaceType,
  parseSalary,
} from "../../utils/normalize.ts";

const USER_AGENT = "Curastem-Jobs-Ingestion/1.0 (developers@curastem.org)";

/** Extract tag content from XML string; handles CDATA. `tag` may include a namespace (e.g. `g:location`). */
function getTagContent(xml: string, tag: string): string | null {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const match = xml.match(regex);
  if (!match) return null;
  let content = match[1].trim();
  const cdataMatch = content.match(/^<!\[CDATA\[([\s\S]*)\]\]>$/);
  if (cdataMatch) content = cdataMatch[1];
  return content || null;
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

/**
 * Extract company/institution name from job title or description.
 * Common patterns: "Title at Company", "Title - Company", "Company: Title"
 */
function extractCompany(
  title: string,
  description: string | null,
  sourceName: string
): string {
  const atMatch = title.match(/\s+at\s+(.+)$/i);
  if (atMatch) return atMatch[1].trim();

  const dashMatch = title.match(/\s+[-–—]\s+(.+)$/i) ?? title.match(/^(.+?)\s+[-–—]\s+/);
  if (dashMatch) return dashMatch[1].trim();

  if (description) {
    const companyMatch = description.match(/^(?:Employer|Company|Institution)[:\s]+([^\n<]+)/i);
    if (companyMatch) return companyMatch[1].trim();
  }

  return sourceName;
}

/**
 * Parse RSS 2.0 item XML block into NormalizedJob.
 */
function parseItem(itemXml: string, sourceName: string): NormalizedJob | null {
  const title = getTagContent(itemXml, "title");
  if (!title) return null;

  const link = getTagContent(itemXml, "link");
  if (!link) return null;

  const description = getTagContent(itemXml, "description");
  const guid = getTagContent(itemXml, "guid");
  const pubDate = getTagContent(itemXml, "pubDate");

  // Google Jobs RSS extensions (e.g. Foundever / SAP SuccessFactors career sites)
  const gId = getTagContent(itemXml, "g:id");
  const gLocation = getTagContent(itemXml, "g:location");
  const gEmployer = getTagContent(itemXml, "g:employer");

  const externalId = gId ?? guid ?? link;
  const locationRaw = gLocation ?? null;
  const location =
    normalizeLocation(locationRaw ?? "") ?? normalizeLocation(description ?? "");

  const companyName = gEmployer
    ? decodeXmlEntities(gEmployer).replace(/\u00ae/g, "").trim()
    : extractCompany(title, description, sourceName);
  const salary = parseSalary(description);

  let postedAt: number | null = null;
  if (pubDate) {
    const parsed = Date.parse(pubDate);
    if (!Number.isNaN(parsed)) postedAt = Math.floor(parsed / 1000);
  }

  return {
    external_id: externalId,
    title,
    location,
    employment_type: normalizeEmploymentType(null),
    workplace_type: normalizeWorkplaceType(null, description ?? undefined),
    apply_url: link,
    source_url: link,
    description_raw: description,
    salary_min: salary.min,
    salary_max: salary.max,
    salary_currency: salary.currency,
    salary_period: salary.period,
    posted_at: postedAt,
    company_name: companyName,
  };
}

export const rssFetcher: JobSource = {
  sourceType: "rss",

  async fetch(source: SourceRow): Promise<NormalizedJob[]> {
    const res = await fetch(source.base_url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/rss+xml, application/xml, text/xml, */*",
      },
    });

    if (!res.ok) {
      throw new Error(`RSS fetch error ${res.status} for ${source.company_handle}`);
    }

    const xmlText = await res.text();
    const sourceName = source.name.replace(/\s*\(RSS\)\s*/i, "").trim();
    const jobs: NormalizedJob[] = [];

    const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
    let match: RegExpExecArray | null;
    while ((match = itemRegex.exec(xmlText)) !== null) {
      try {
        const job = parseItem(match[1], sourceName);
        if (job) jobs.push(job);
      } catch {
        continue;
      }
    }

    return jobs;
  },
};
