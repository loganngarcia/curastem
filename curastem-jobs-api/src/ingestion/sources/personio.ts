/**
 * Personio public XML career page fetcher.
 *
 * Personio exposes a public, unauthenticated XML feed for all companies that
 * have enabled their careers page. No API key required.
 *
 * API format: https://{handle}.jobs.personio.de/xml
 *
 * Response format: XML with a standard feed structure. We use DOMParser — 
 * available natively in Cloudflare Workers — to parse it without any
 * third-party library.
 *
 * Personio is the dominant HR platform in the German-speaking DACH region
 * (Germany, Austria, Switzerland) and expanding across Europe. Covers a wide
 * variety of roles including non-tech, operations, retail, and finance.
 */

import type { JobSource, NormalizedJob, SourceRow } from "../../types.ts";
import {
  normalizeEmploymentType,
  normalizeLocation,
  normalizeWorkplaceType,
  parseEpochSeconds,
} from "../../utils/normalize.ts";

/**
 * Extract text content from the first matching XML element.
 * Returns null if the element is missing or empty.
 */
function getText(parent: XmlElement, tagName: string): string | null {
  const el = parent.getElementsByTagName(tagName)[0];
  const text = el?.textContent?.trim() ?? null;
  return text || null;
}

/**
 * Parse a Personio XML job entry (<job> element) into a NormalizedJob.
 * The XML schema varies slightly by account; we defensively handle missing fields.
 */
function parseJobElement(el: XmlElement, companyName: string): NormalizedJob | null {
  const externalId = getText(el, "id");
  const title = getText(el, "name");
  const applyUrl = getText(el, "apply_url") ?? getText(el, "applicationUrl");

  if (!externalId || !title || !applyUrl) return null;

  const location = getText(el, "office") ?? getText(el, "location");
  const department = getText(el, "department");
  const employmentTypeRaw = getText(el, "schedule") ?? getText(el, "employment_type");
  const remoteHint = getText(el, "remote") ?? getText(el, "workplace");
  const createdAt = getText(el, "created_at") ?? getText(el, "createdAt");

  // Build description from all description-like fields
  const descriptionParts: string[] = [];
  const descEl = el.getElementsByTagName("jobDescriptions")[0];
  if (descEl) {
    const sections = descEl.getElementsByTagName("jobDescription");
    for (const section of sections) {
      const name = getText(section, "name");
      const value = getText(section, "value");
      if (value) {
        if (name) descriptionParts.push(`<h3>${name}</h3>\n${value}`);
        else descriptionParts.push(value);
      }
    }
  }
  // Fallback: look for a top-level description or summary field
  if (descriptionParts.length === 0) {
    const rawDesc = getText(el, "description") ?? getText(el, "summary");
    if (rawDesc) descriptionParts.push(rawDesc);
  }

  const locationHint = [remoteHint, location].filter(Boolean).join(" ");

  return {
    external_id: externalId,
    title,
    location: normalizeLocation(
      department && location ? `${location} (${department})` : location
    ),
    employment_type: normalizeEmploymentType(employmentTypeRaw),
    workplace_type: normalizeWorkplaceType(locationHint),
    apply_url: applyUrl,
    source_url: applyUrl,
    description_raw: descriptionParts.length > 0 ? descriptionParts.join("\n\n") : null,
    salary_min: null,
    salary_max: null,
    salary_currency: null,
    salary_period: null,
    posted_at: parseEpochSeconds(createdAt),
    company_name: companyName,
  };
}

export const personioFetcher: JobSource = {
  sourceType: "personio",

  async fetch(source: SourceRow): Promise<NormalizedJob[]> {
    const res = await fetch(source.base_url, {
      headers: {
        "User-Agent": "Curastem-Jobs-Ingestion/1.0 (developers@curastem.org)",
        Accept: "application/xml, text/xml, */*",
      },
    });

    if (!res.ok) {
      throw new Error(`Personio XML error ${res.status} for ${source.company_handle}`);
    }

    const xmlText = await res.text();
    const parser = new DOMParser();
    const doc: XmlDocument = parser.parseFromString(xmlText, "application/xml");

    // Check for XML parse errors
    const parserError = doc.querySelector("parsererror");
    if (parserError) {
      throw new Error(`Personio XML parse error for ${source.company_handle}: ${parserError.textContent}`);
    }

    const companyName = source.name.replace(/\s*\(Personio\)\s*/i, "").trim();
    const jobElements = doc.getElementsByTagName("job");
    const jobs: NormalizedJob[] = [];

    for (const el of jobElements) {
      try {
        const job = parseJobElement(el, companyName);
        if (job) jobs.push(job);
      } catch {
        continue;
      }
    }

    return jobs;
  },
};
