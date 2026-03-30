/**
 * Avature-hosted career sites expose a public RSS feed at
 * `{locale}/careers/SearchJobs/feed/` (locale prefix optional in practice).
 * Example: `https://delta.avature.net/careers/SearchJobs/feed/`
 *
 * Items include title, link, guid, pubDate; `<description>` is often only ` - {jobId}`.
 * Tenants expose a **recent-postings** feed on `…/careers/SearchJobs/feed/` (row count varies;
 * no historical backfill). Search HTML and locale sitemaps are often AWS WAF–blocked for
 * server-side HTTP clients, so we do not crawl posting HTML — only RSS fields and numeric
 * `external_id` from the JobDetail path.
 *
 * `base_url` must be the feed URL (ends with `feed/` or `feed`).
 */

import type { JobSource, NormalizedJob, SourceRow } from "../../types.ts";
import {
  normalizeEmploymentType,
  normalizeLocation,
  normalizeWorkplaceType,
  parseSalary,
} from "../../utils/normalize.ts";

const USER_AGENT = "Curastem-Jobs-Ingestion/1.0 (developers@curastem.org)";

function getTagContent(xml: string, tag: string): string | null {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const match = xml.match(regex);
  if (!match) return null;
  let content = match[1].trim();
  const cdataMatch = content.match(/^<!\[CDATA\[([\s\S]*)\]\]>$/);
  if (cdataMatch) content = cdataMatch[1];
  return content || null;
}

function externalIdFromAvatureLink(link: string): string | null {
  try {
    const u = new URL(link.split("&amp;").join("&"));
    const m = u.pathname.match(/\/(\d+)\/?$/);
    if (m) return m[1];
  } catch {
    /* ignore */
  }
  return null;
}

function parseItem(itemXml: string, companyName: string): NormalizedJob | null {
  const title = getTagContent(itemXml, "title");
  if (!title) return null;

  const link = getTagContent(itemXml, "link");
  if (!link) return null;

  const linkNorm = link.split("&amp;").join("&");
  const externalId = externalIdFromAvatureLink(linkNorm) ?? linkNorm;

  const description = getTagContent(itemXml, "description");
  const pubDate = getTagContent(itemXml, "pubDate");

  const location =
    normalizeLocation(description ?? "") ??
    normalizeLocation(title);

  const salary = parseSalary(description);

  let postedAt: number | null = null;
  if (pubDate) {
    const parsed = Date.parse(pubDate);
    if (!Number.isNaN(parsed)) postedAt = Math.floor(parsed / 1000);
  }

  const descTrim = description?.trim() || null;
  const descriptionRaw =
    descTrim && descTrim.length > 8 && !/^[\s-]*\d+[\s.]*$/.test(descTrim)
      ? descTrim
      : title;

  return {
    external_id: externalId,
    title: title.trim(),
    location,
    employment_type: normalizeEmploymentType(null),
    workplace_type: normalizeWorkplaceType(null, title),
    apply_url: linkNorm,
    source_url: linkNorm,
    description_raw: descriptionRaw,
    salary_min: salary.min,
    salary_max: salary.max,
    salary_currency: salary.currency,
    salary_period: salary.period,
    posted_at: postedAt,
    company_name: companyName,
  };
}

export const avatureFetcher: JobSource = {
  sourceType: "avature",

  async fetch(source: SourceRow): Promise<NormalizedJob[]> {
    const res = await fetch(source.base_url.trim(), {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/rss+xml, application/xml, text/xml, */*",
      },
    });

    if (!res.ok) {
      throw new Error(`avature: RSS ${res.status} for ${source.company_handle}`);
    }

    const xmlText = await res.text();
    const companyName = source.name.replace(/\s*\([^)]*\)\s*$/, "").trim() || source.company_handle;

    const jobs: NormalizedJob[] = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
    let match: RegExpExecArray | null;
    while ((match = itemRegex.exec(xmlText)) !== null) {
      try {
        const job = parseItem(match[1], companyName);
        if (job) jobs.push(job);
      } catch {
        continue;
      }
    }

    if (jobs.length === 0) {
      throw new Error(`avature: 0 items parsed from ${source.base_url}`);
    }

    return jobs;
  },
};
