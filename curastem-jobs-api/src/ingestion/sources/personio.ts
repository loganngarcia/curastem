/**
 * Personio public XML career page fetcher.
 *
 * Personio exposes a public, unauthenticated XML feed for all companies that
 * have enabled their careers page. No API key required.
 *
 * API format: https://{handle}.jobs.personio.de/xml
 *
 * Response format: XML with <workzag-jobs><position> or <job> elements.
 * Uses fast-xml-parser (Workers-compatible) instead of DOMParser.
 */

import { XMLParser } from "fast-xml-parser";
import type { JobSource, NormalizedJob, SourceRow } from "../../types.ts";
import {
  normalizeEmploymentType,
  normalizeLocation,
  normalizeWorkplaceType,
  parseEpochSeconds,
} from "../../utils/normalize.ts";

type XmlObject = Record<string, unknown>;

function getText(obj: XmlObject | null | undefined, key: string): string | null {
  if (!obj || typeof obj !== "object") return null;
  const val = obj[key];
  if (val == null) return null;
  if (typeof val === "object" && !Array.isArray(val) && "#text" in val) {
    const t = (val as XmlObject)["#text"];
    return typeof t === "string" ? t.trim() || null : null;
  }
  const s = String(val).trim();
  return s || null;
}

function getTextAlt(obj: XmlObject | null | undefined, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = getText(obj, k);
    if (v) return v;
  }
  return null;
}

/**
 * Extract job/position elements from parsed XML. Personio uses <position> or <job>.
 */
function extractJobElements(parsed: XmlObject): XmlObject[] {
  const root = parsed;
  if (!root || typeof root !== "object") return [];

  const candidates: XmlObject[] = [];
  for (const key of ["position", "job", "positions", "jobs"]) {
    const val = root[key];
    if (Array.isArray(val)) candidates.push(...val.filter((v): v is XmlObject => v && typeof v === "object"));
    else if (val && typeof val === "object" && !Array.isArray(val)) candidates.push(val as XmlObject);
  }
  // Nested: workzag-jobs.position, etc.
  for (const v of Object.values(root)) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const nested = extractJobElements(v as XmlObject);
      if (nested.length) return nested;
    }
  }
  return candidates;
}

function parseJobElement(el: XmlObject, companyName: string): NormalizedJob | null {
  const externalId = getTextAlt(el, "id");
  const title = getTextAlt(el, "name", "title");
  const applyUrl = getTextAlt(el, "apply_url", "applicationUrl", "url");

  if (!externalId || !title || !applyUrl) return null;

  const location = getTextAlt(el, "office", "location");
  const department = getTextAlt(el, "department");
  const employmentTypeRaw = getTextAlt(el, "schedule", "employment_type", "employmentType");
  const remoteHint = getTextAlt(el, "remote", "workplace");
  const createdAt = getTextAlt(el, "created_at", "createdAt");

  const descriptionParts: string[] = [];
  const descEl = el["jobDescriptions"];
  if (descEl && typeof descEl === "object" && !Array.isArray(descEl)) {
    const sections = (descEl as XmlObject)["jobDescription"];
    const arr = Array.isArray(sections) ? sections : sections ? [sections] : [];
    for (const section of arr) {
      if (section && typeof section === "object" && !Array.isArray(section)) {
        const name = getText(section as XmlObject, "name");
        const value = getText(section as XmlObject, "value");
        if (value) {
          if (name) descriptionParts.push(`<h3>${name}</h3>\n${value}`);
          else descriptionParts.push(value);
        }
      }
    }
  }
  if (descriptionParts.length === 0) {
    const rawDesc = getTextAlt(el, "description", "summary");
    if (rawDesc) descriptionParts.push(rawDesc);
  }

  const locationHint = [remoteHint, location].filter(Boolean).join(" ");

  return {
    external_id: externalId,
    title,
    location: normalizeLocation(
      department && location ? `${location} (${department})` : location ?? undefined
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
    const parser = new XMLParser({ ignoreAttributes: true });
    const parsed = parser.parse(xmlText) as XmlObject;

    if (!parsed || typeof parsed !== "object") {
      throw new Error(`Personio XML parse error for ${source.company_handle}: invalid structure`);
    }

    const companyName = source.name.replace(/\s*\(Personio\)\s*/i, "").trim();
    const jobElements = extractJobElements(parsed);
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
