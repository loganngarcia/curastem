/**
 * Generic RSS job board fetcher.
 *
 * Job boards that expose RSS feeds (e.g. HigherEdJobs) can be ingested without
 * scraping. Standard RSS 2.0 format is supported. Company name is extracted
 * from title or description when possible; otherwise the source name is used.
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

/** Extract tag content from XML string; handles CDATA. */
function getTagContent(xml: string, tag: string): string | null {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const match = xml.match(regex);
  if (!match) return null;
  let content = match[1].trim();
  const cdataMatch = content.match(/^<!\[CDATA\[([\s\S]*)\]\]>$/);
  if (cdataMatch) content = cdataMatch[1];
  return content || null;
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
  const externalId = getTagContent(itemXml, "guid");
  const pubDate = getTagContent(itemXml, "pubDate");

  const companyName = extractCompany(title, description, sourceName);
  const salary = parseSalary(description);

  let postedAt: number | null = null;
  if (pubDate) {
    const parsed = Date.parse(pubDate);
    if (!Number.isNaN(parsed)) postedAt = Math.floor(parsed / 1000);
  }

  return {
    external_id: externalId ?? link,
    title,
    location: normalizeLocation(description ?? ""),
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
