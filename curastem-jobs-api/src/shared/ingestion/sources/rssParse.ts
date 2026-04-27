/**
 * Shared RSS 2.0 parsing for job feeds (used by rss.ts).
 */

import type { NormalizedJob } from "../../types.ts";
import {
  normalizeEmploymentType,
  normalizeLocation,
  normalizeWorkplaceType,
  parseSalary,
} from "../../utils/normalize.ts";

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

function extractCompany(title: string, description: string | null, sourceName: string): string {
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

function parseItem(itemXml: string, sourceName: string): NormalizedJob | null {
  const title = getTagContent(itemXml, "title");
  if (!title) return null;

  const link = getTagContent(itemXml, "link");
  if (!link) return null;

  const description = getTagContent(itemXml, "description");
  const guid = getTagContent(itemXml, "guid");
  const pubDate = getTagContent(itemXml, "pubDate");

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

export function dedupeByExternalId(jobs: NormalizedJob[]): NormalizedJob[] {
  const seen = new Set<string>();
  const out: NormalizedJob[] = [];
  for (const j of jobs) {
    if (seen.has(j.external_id)) continue;
    seen.add(j.external_id);
    out.push(j);
  }
  return out;
}

export function parseRssXmlToJobs(xmlText: string, sourceName: string): NormalizedJob[] {
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
}
