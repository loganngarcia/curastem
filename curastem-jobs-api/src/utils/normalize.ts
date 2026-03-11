/**
 * Normalization utilities.
 *
 * These functions convert raw, source-specific values into the Curastem
 * canonical schema. All source fetchers call these helpers so that
 * normalization logic lives in one place and is testable independently.
 */

import type { EmploymentType, SalaryPeriod, WorkplaceType } from "../types.ts";

// ─────────────────────────────────────────────────────────────────────────────
// Company slug
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert a company name to a URL-safe, lowercase slug used as a dedup key
 * across sources. E.g. "Acme Corp." → "acme-corp".
 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

// ─────────────────────────────────────────────────────────────────────────────
// Deduplication key
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a cross-source deduplication key from job title and company slug.
 * This catches the same posting appearing on Greenhouse and SmartRecruiters,
 * for example, and lets us prefer the higher-trust source.
 */
export function buildDedupKey(title: string, companySlug: string): string {
  const normalizedTitle = title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ");
  return `${normalizedTitle}|${companySlug}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Employment type
// ─────────────────────────────────────────────────────────────────────────────

const EMPLOYMENT_TYPE_MAP: Record<string, EmploymentType> = {
  // Greenhouse
  full_time: "full_time",
  part_time: "part_time",
  contract: "contract",
  internship: "internship",
  temporary: "temporary",
  // Lever
  "full-time": "full_time",
  "part-time": "part_time",
  intern: "internship",
  // Workday / SmartRecruiters
  "full time": "full_time",
  "part time": "part_time",
  regular: "full_time",
  "fixed-term": "temporary",
  freelance: "contract",
};

export function normalizeEmploymentType(raw: string | null | undefined): EmploymentType | null {
  if (!raw) return null;
  const key = raw.toLowerCase().trim();
  return EMPLOYMENT_TYPE_MAP[key] ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Workplace type (remote / hybrid / on_site)
// ─────────────────────────────────────────────────────────────────────────────

export function normalizeWorkplaceType(
  raw: string | null | undefined,
  locationHint?: string | null
): WorkplaceType | null {
  const text = (raw ?? locationHint ?? "").toLowerCase();
  if (text.includes("remote")) return "remote";
  if (text.includes("hybrid")) return "hybrid";
  if (text.includes("on-site") || text.includes("on site") || text.includes("onsite") || text.includes("in-person")) return "on_site";
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Salary parsing
// ─────────────────────────────────────────────────────────────────────────────

interface ParsedSalary {
  min: number | null;
  max: number | null;
  currency: string | null;
  period: SalaryPeriod | null;
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  "$": "USD",
  "£": "GBP",
  "€": "EUR",
  "¥": "JPY",
  "₹": "INR",
  "C$": "CAD",
  "A$": "AUD",
};

/**
 * Attempt to extract salary range from a freeform string.
 * Examples: "$80k–$120k/yr", "£50,000 - £70,000 per year", "25-35 USD/hr"
 *
 * Returns all nulls if parsing fails — salary is always optional.
 */
export function parseSalary(raw: string | null | undefined): ParsedSalary {
  const empty: ParsedSalary = { min: null, max: null, currency: null, period: null };
  if (!raw) return empty;

  // Detect currency
  let currency: string | null = null;
  for (const [sym, code] of Object.entries(CURRENCY_SYMBOLS)) {
    if (raw.includes(sym)) {
      currency = code;
      break;
    }
  }
  // Also check for ISO codes like "USD", "EUR"
  const isoMatch = raw.match(/\b(USD|GBP|EUR|JPY|INR|CAD|AUD)\b/i);
  if (!currency && isoMatch) currency = isoMatch[1].toUpperCase();

  // Detect period
  let period: SalaryPeriod | null = null;
  if (/\/?\s*(yr|year|annual|annually)/i.test(raw)) period = "year";
  else if (/\/?\s*(mo|month|monthly)/i.test(raw)) period = "month";
  else if (/\/?\s*(hr|hour|hourly)/i.test(raw)) period = "hour";

  // Extract numbers (handle "k" suffix = ×1000)
  const numbers = [...raw.matchAll(/[\d,]+(?:\.\d+)?k?/gi)].map((m) => {
    const s = m[0].replace(/,/g, "");
    const multiplier = s.toLowerCase().endsWith("k") ? 1000 : 1;
    return parseFloat(s) * multiplier;
  });

  if (numbers.length === 0) return empty;
  const min = numbers[0];
  const max = numbers.length > 1 ? numbers[1] : null;

  return { min, max, currency, period };
}

// ─────────────────────────────────────────────────────────────────────────────
// Location normalization
// ─────────────────────────────────────────────────────────────────────────────

const US_STATE_ABBREVS: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR",
  california: "CA", colorado: "CO", connecticut: "CT", delaware: "DE",
  florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID",
  illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS",
  kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD",
  massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS",
  missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
  "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK",
  oregon: "OR", pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC",
  "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT",
  vermont: "VT", virginia: "VA", washington: "WA", "west virginia": "WV",
  wisconsin: "WI", wyoming: "WY", "district of columbia": "DC",
};

// Well-known tech-hub cities that appear without a state suffix
const BARE_CITY_MAP: Record<string, string> = {
  "san francisco": "San Francisco, CA",
  sf: "San Francisco, CA",
  "palo alto": "Palo Alto, CA",
  "menlo park": "Menlo Park, CA",
  "mountain view": "Mountain View, CA",
  sunnyvale: "Sunnyvale, CA",
  "santa clara": "Santa Clara, CA",
  "redwood city": "Redwood City, CA",
  "san jose": "San Jose, CA",
  "san diego": "San Diego, CA",
  "los angeles": "Los Angeles, CA",
  la: "Los Angeles, CA",
  "new york": "New York, NY",
  "new york city": "New York City, NY",
  nyc: "New York City, NY",
  brooklyn: "Brooklyn, NY",
  seattle: "Seattle, WA",
  boston: "Boston, MA",
  chicago: "Chicago, IL",
  austin: "Austin, TX",
  denver: "Denver, CO",
  atlanta: "Atlanta, GA",
  miami: "Miami, FL",
  portland: "Portland, OR",
  "washington dc": "Washington, DC",
  dc: "Washington, DC",
};

/**
 * Normalize a raw location string to a consistent "City, ST" / "Remote" format.
 *
 * Rules (applied in order):
 *   1. If the string mentions "remote" and not "hybrid" → "Remote"
 *   2. Multi-location strings (e.g. "SF / NYC / Boston") → first location only
 *   3. Full state name → abbreviation ("California" → "CA")
 *   4. Bare city name → look up known tech hubs
 *   5. Everything else → return the first segment as-is
 */
export function normalizeLocation(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim().replace(/\s+/g, " ");
  if (!s) return null;

  const lower = s.toLowerCase();

  // Remote detection — covers "Remote", "Fully Remote", "Remote with offices in...", "100% Remote"
  if (/\bremote\b/.test(lower) && !/\bhybrid\b/.test(lower)) return "Remote";

  // Split multi-location strings on "/" "|" ";" and take the first segment
  const first = s.split(/\s*[\/|;]\s*/)[0].trim();
  const firstLower = first.toLowerCase();

  // Bare city lookup
  if (BARE_CITY_MAP[firstLower]) return BARE_CITY_MAP[firstLower];

  // "City, Full State Name" or "City, ST" — normalize state
  const commaMatch = first.match(/^(.+?),\s*([^,]+)$/);
  if (commaMatch) {
    const city = commaMatch[1].trim();
    const stateRaw = commaMatch[2].trim();
    const abbrev = US_STATE_ABBREVS[stateRaw.toLowerCase()];
    // Use abbreviation if found, or keep as-is if already 2 chars (e.g. "CA"), or international
    const state = abbrev ?? (stateRaw.length === 2 ? stateRaw.toUpperCase() : stateRaw);
    return `${city}, ${state}`;
  }

  return first || null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Date parsing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse a date value into a Unix epoch (seconds).
 * Accepts ISO 8601 strings, millisecond epoch numbers, or second epoch numbers.
 * Returns null if the value is unparseable.
 */
export function parseEpochSeconds(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;

  if (typeof raw === "number") {
    // Distinguish millisecond vs second epoch by magnitude
    return raw > 1e10 ? Math.floor(raw / 1000) : raw;
  }

  if (typeof raw === "string") {
    const n = Date.parse(raw);
    if (isNaN(n)) return null;
    return Math.floor(n / 1000);
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Job ID generation (deterministic)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Produce a deterministic job ID from source_id and external_id using a
 * simple Base64url encoding without a crypto dependency (Workers have SubtleCrypto
 * but we keep this synchronous for simplicity in the ingestion path).
 *
 * The resulting ID is stable: re-ingesting the same job always produces the same ID.
 */
export function buildJobId(sourceId: string, externalId: string): string {
  const raw = `${sourceId}:${externalId}`;
  // Use btoa for a lightweight, deterministic encoding
  // Replace chars not safe in URLs
  return btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

// ─────────────────────────────────────────────────────────────────────────────
// UUID v4 (for company and source IDs where determinism isn't needed)
// ─────────────────────────────────────────────────────────────────────────────

export function uuidv4(): string {
  return crypto.randomUUID();
}

// ─────────────────────────────────────────────────────────────────────────────
// HTML → plain text (for AI extraction input)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Strip HTML tags from a raw job description before sending to Gemini.
 * This reduces token usage and avoids leaking HTML markup into AI prompts.
 * We do this with regex rather than a DOM parser since Workers run in an
 * edge environment without a full DOM.
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(p|div|li|h[1-6]|ul|ol|section|article)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
