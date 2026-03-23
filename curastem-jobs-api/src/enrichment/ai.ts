/**
 * Gemini-powered AI extraction for job and company fields.
 *
 * Model: gemini-3.1-flash-lite-preview
 * Rationale: most cost-efficient and fastest model in the Gemini 3.1 family, appropriate
 * for lightweight extraction tasks where we are NOT inventing facts — only
 * pulling structured data from existing source text.
 *
 * Extraction philosophy:
 *   - We extract, we do not invent. If a section is absent from the raw text,
 *     the array for that section is empty rather than hallucinated.
 *   - AI results are cached in D1. Re-generation only happens when:
 *       a) ai_generated_at is NULL (never generated), or
 *       b) description_raw changed (ai_generated_at was cleared by upsertJob)
 *   - This prevents redundant token consumption on every request.
 *
 * Caching is handled by the caller (routes/job.ts), not here, to keep
 * this module focused on the Gemini call itself.
 */

import type { JobDescriptionExtracted } from "../types.ts";
import type { ListingQuality } from "../types.ts";
import { heuristicListingQuality } from "../utils/listingQuality.ts";
import { htmlToText } from "../utils/normalize.ts";

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";

// ─────────────────────────────────────────────────────────────────────────────
// Embedding model
//
// gemini-embedding-2-preview: Google's latest multimodal embedding model.
// https://ai.google.dev/gemini-api/docs/embeddings
//
// We use 768-dimensional output (down from the 3072 default) via the MRL
// (Matryoshka Representation Learning) technique — MTEB benchmark shows 768
// dimensions score 67.99 vs 68.16 for 3072, a negligible quality difference
// that saves ~75% storage and query cost in Vectorize.
//
// Task types are asymmetric:
//   RETRIEVAL_DOCUMENT — for job text indexed at ingestion time
//   RETRIEVAL_QUERY    — for user search queries at request time
// Using the correct task type is critical for retrieval quality.
// ─────────────────────────────────────────────────────────────────────────────

const EMBEDDING_MODEL = "gemini-embedding-2-preview";
const EMBEDDING_DIMENSIONS = 768;

interface GeminiEmbedRequest {
  model: string;
  content: { parts: Array<{ text: string }> };
  taskType: string;
  outputDimensionality: number;
}

interface GeminiEmbedResponse {
  embedding?: { values: number[] };
}

async function callGeminiEmbed(
  apiKey: string,
  text: string,
  taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY"
): Promise<number[]> {
  const url = `${GEMINI_API_BASE}/models/${EMBEDDING_MODEL}:embedContent?key=${apiKey}`;
  const body: GeminiEmbedRequest = {
    model: `models/${EMBEDDING_MODEL}`,
    content: { parts: [{ text }] },
    taskType,
    outputDimensionality: EMBEDDING_DIMENSIONS,
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini Embedding API error ${res.status}: ${err}`);
  }

  const data = (await res.json()) as GeminiEmbedResponse;
  const values = data.embedding?.values;
  if (!values || values.length === 0) {
    throw new Error("Gemini Embedding returned empty vector");
  }
  return values;
}

/**
 * Build the canonical text representation of a job for embedding.
 * Combines title, company, location, and a truncated description so the
 * vector captures the job's full semantic meaning, not just the title.
 */
function buildJobEmbedText(
  title: string,
  companyName: string,
  location: string | null,
  descriptionRaw: string | null
): string {
  const parts: string[] = [`${title} at ${companyName}`];
  if (location) parts.push(`Location: ${location}`);
  if (descriptionRaw) {
    const cleaned = htmlToText(descriptionRaw).slice(0, 1500);
    parts.push(cleaned);
  }
  return parts.join("\n");
}

/**
 * Generate a 768-dimensional embedding for a job, for storage in Vectorize.
 * Call this at ingestion time whenever a job is new or its description changed.
 */
export async function embedJob(
  apiKey: string,
  title: string,
  companyName: string,
  location: string | null,
  descriptionRaw: string | null
): Promise<number[]> {
  const text = buildJobEmbedText(title, companyName, location, descriptionRaw);
  return callGeminiEmbed(apiKey, text, "RETRIEVAL_DOCUMENT");
}

/**
 * Generate a 768-dimensional embedding for a search query.
 * Call this at search time when q= is provided in GET /jobs.
 */
export async function embedQuery(
  apiKey: string,
  query: string
): Promise<number[]> {
  return callGeminiEmbed(apiKey, query, "RETRIEVAL_QUERY");
}

/**
 * Model selection: gemini-3.1-flash-lite-preview
 *
 * https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite-preview
 *
 * Google's smallest, fastest, and cheapest Gemini model. We deliberately
 * choose this over larger models because our tasks are extraction-only
 * (pulling structured facts out of existing text, never creative generation).
 * Intelligence ceiling matters far less than token cost and latency here.
 *
 * Called on Cloudflare Workers via direct REST to the Gemini API endpoint.
 * No Cloudflare AI binding is needed — the API key is injected as a secret.
 *
 * To upgrade the model: change this constant only. All prompts and JSON
 * response parsing are model-agnostic and will work with any Gemini variant.
 */
const MODEL = "gemini-3.1-flash-lite-preview";

interface GeminiRequest {
  contents: Array<{ parts: Array<{ text: string }> }>;
  generationConfig?: {
    temperature?: number;
    maxOutputTokens?: number;
  };
}

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
}

async function callGemini(apiKey: string, prompt: string, maxOutputTokens = 2048): Promise<string> {
  const url = `${GEMINI_API_BASE}/models/${MODEL}:generateContent?key=${apiKey}`;
  const body: GeminiRequest = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens,
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${err}`);
  }

  const data = (await res.json()) as GeminiResponse;
  const text = data.candidates?.[0]?.content?.parts?.find((p) => p.text)?.text;
  if (!text) throw new Error("Gemini returned empty response");
  return text;
}

// ─────────────────────────────────────────────────────────────────────────────
// Job description extraction — single plain-JSON call, no function calling.
//
// Salary is included as optional fields in the same JSON blob. This avoids
// the Gemini function-calling edge case where the model returns a functionCall
// part with no text part, causing the extraction to silently fail.
// ─────────────────────────────────────────────────────────────────────────────

const JOB_EXTRACTION_PROMPT = (companyName: string, jobTitle: string, descriptionText: string) => `
You are an assistant that extracts structured information from job postings.

Company: ${companyName}
Job title: ${jobTitle}

Raw job description:
---
${descriptionText.slice(0, 8000)}
---

Return ONLY valid JSON (no markdown fences) with exactly this shape:
{
  "job_summary": "<two sentences>",
  "responsibilities": ["<bullet>", ...],
  "minimum_qualifications": ["<bullet>", ...],
  "preferred_qualifications": ["<bullet>", ...],
  "listing_quality": "<ok|placeholder>",
  "workplace_type": "<remote|hybrid|on_site|null>",
  "employment_type": "<full_time|part_time|contract|internship|temporary|null>",
  "seniority_level": "<new_grad|entry|mid|senior|staff|manager|director|executive|null>",
  "description_language": "<ISO 639-1 code or null>",
  "visa_sponsorship": "<yes|no|null>",
  "salary_min": <number or null>,
  "salary_period": "<year|month|hour|null>",
  "locations": ["<City, ST or City, Country>", ...]
}

Rules:
- job_summary: exactly two sentences. Sentence 1 describes the company. Sentence 2 describes this role.
- listing_quality: "placeholder" if the posting is a teaser with no real role description (e.g. only "apply to learn more", empty sections, or generic CTA with no duties, requirements, or role scope). "ok" if there is enough substance that a candidate could understand the role without applying first.
- Each array item must be a concise, standalone point. No raw HTML.
- Return empty arrays [] for any section not clearly present in the source text.
- workplace_type: "remote" if fully remote, "hybrid" if hybrid/flexible, "on_site" if in-office only. null if not mentioned.
- employment_type: "full_time", "part_time", "contract", "internship", or "temporary". null if not mentioned.
- seniority_level: career level — new_grad | entry | mid | senior | staff | manager | director | executive | null.
    "new_grad" = explicitly targets new/recent graduates ("New Grad", "Campus Hire", etc.). "Junior"/"Associate" are entry, not new_grad.
    "manager" = people manager with direct reports. Note: "manager" in a title (Product Manager, Account Manager) does not automatically mean manager seniority 
    null = ambiguous or not enough information. 
- description_language: ISO 639-1 code of the job description's primary language. null only if too short or garbled to determine.
- visa_sponsorship: "yes" if the posting explicitly states visa sponsorship is available, "no" if it explicitly states sponsorship is NOT available or requires existing work authorization. null if not mentioned at all.
- salary_min: the minimum salary amount in USD if explicitly stated, otherwise null. Keep per-period amount as-is (do not annualize hourly/monthly).
- salary_period: "year", "month", or "hour" matching salary_min. null if no salary.
- locations: array of all work locations extracted from the posting. Use canonical format "City, ST" for US cities (e.g. "San Francisco, CA") or "City, Country" for international. Include "Remote" as a location if the role is remote. Return [] if no location is mentioned. First entry should be the primary/most specific location.
- Do NOT invent information not present in the text.
`.trim();

export interface ExtractedJobFields {
  job_summary: string;
  job_description: JobDescriptionExtracted;
  workplace_type: import("../types.ts").WorkplaceType | null;
  employment_type: import("../types.ts").EmploymentType | null;
  seniority_level: import("../types.ts").SeniorityLevel | null;
  /** ISO 639-1 language code of the job description. AI always overrides the heuristic value. */
  description_language: import("../types.ts").DescriptionLanguage | null;
  visa_sponsorship: import("../types.ts").VisaSponsorship | null;
  salary_min: number | null;
  salary_currency: string | null;
  salary_period: import("../types.ts").SalaryPeriod | null;
  /** Normalized locations extracted from the posting; first entry is primary. */
  locations: string[] | null;
  /** Whether this row is a substantive job posting or a teaser with no real description. */
  listing_quality: ListingQuality;
}

/** Format a salary for display, e.g. "$120,000" or "$45/hour" */
export function formatSalaryDisplay(amount: number, period: "year" | "month" | "hour"): string {
  const formatted = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amount);
  return period === "year" ? formatted : `${formatted}/${period}`;
}

/**
 * Extract job_summary, job_description, and optionally salary from raw description text.
 * Single Gemini call returning flat JSON — no function calling.
 */
export async function extractJobFields(
  apiKey: string,
  companyName: string,
  jobTitle: string,
  descriptionRaw: string
): Promise<ExtractedJobFields> {
  const descriptionText = htmlToText(descriptionRaw);
  const prompt = JOB_EXTRACTION_PROMPT(companyName, jobTitle, descriptionText);
  const raw = await callGemini(apiKey, prompt, 2048);

  const cleaned = raw.replace(/^```json\s*/i, "").replace(/\s*```$/i, "").trim();

  let parsed: {
    job_summary?: string;
    responsibilities?: unknown[];
    minimum_qualifications?: unknown[];
    preferred_qualifications?: unknown[];
    workplace_type?: unknown;
    employment_type?: unknown;
    seniority_level?: unknown;
    description_language?: unknown;
    visa_sponsorship?: unknown;
    salary_min?: unknown;
    salary_period?: unknown;
    locations?: unknown[];
    listing_quality?: unknown;
  };

  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`Failed to parse Gemini response as JSON: ${cleaned.slice(0, 200)}`);
  }

  const ensureStringArray = (val: unknown): string[] => {
    if (!Array.isArray(val)) return [];
    return val.filter((v): v is string => typeof v === "string");
  };

  const WORKPLACE_TYPES = ["remote", "hybrid", "on_site"] as const;
  const EMPLOYMENT_TYPES = ["full_time", "part_time", "contract", "internship", "temporary"] as const;
  const SENIORITY_LEVELS = ["new_grad", "entry", "mid", "senior", "staff", "manager", "director", "executive"] as const;
  // Accept any 2-letter ISO 639-1 code the model returns — not restricted to our heuristic set.
  const isValidLangCode = (v: unknown): v is import("../types.ts").DescriptionLanguage =>
    typeof v === "string" && /^[a-z]{2}$/.test(v);

  const workplaceType = WORKPLACE_TYPES.includes(parsed.workplace_type as never)
    ? (parsed.workplace_type as import("../types.ts").WorkplaceType)
    : null;
  const employmentType = EMPLOYMENT_TYPES.includes(parsed.employment_type as never)
    ? (parsed.employment_type as import("../types.ts").EmploymentType)
    : null;
  const seniorityLevel = SENIORITY_LEVELS.includes(parsed.seniority_level as never)
    ? (parsed.seniority_level as import("../types.ts").SeniorityLevel)
    : null;
  const descriptionLanguage = isValidLangCode(parsed.description_language)
    ? parsed.description_language
    : null;
  const visaSponsorship = (parsed.visa_sponsorship === "yes" || parsed.visa_sponsorship === "no")
    ? (parsed.visa_sponsorship as import("../types.ts").VisaSponsorship)
    : null;

  const salaryMin = typeof parsed.salary_min === "number" && parsed.salary_min > 0
    ? parsed.salary_min
    : null;
  const salaryPeriod = salaryMin !== null && (parsed.salary_period === "year" || parsed.salary_period === "month" || parsed.salary_period === "hour")
    ? parsed.salary_period
    : null;

  const locations = ensureStringArray(parsed.locations);

  const heuristicPh = heuristicListingQuality(descriptionRaw) === "placeholder";
  const listing_quality: ListingQuality =
    parsed.listing_quality === "ok"
      ? "ok"
      : parsed.listing_quality === "placeholder" || heuristicPh
        ? "placeholder"
        : "ok";

  return {
    job_summary: typeof parsed.job_summary === "string" ? parsed.job_summary : "",
    job_description: {
      responsibilities: ensureStringArray(parsed.responsibilities),
      minimum_qualifications: ensureStringArray(parsed.minimum_qualifications),
      preferred_qualifications: ensureStringArray(parsed.preferred_qualifications),
    },
    workplace_type: workplaceType,
    employment_type: employmentType,
    seniority_level: seniorityLevel,
    description_language: descriptionLanguage,
    visa_sponsorship: visaSponsorship,
    salary_min: salaryMin,
    salary_currency: salaryMin !== null ? "USD" : null,
    salary_period: salaryPeriod,
    locations: locations.length > 0 ? locations : null,
    listing_quality,
  };
}

const LISTING_QUALITY_CLASSIFY_PROMPT = (companyName: string, jobTitle: string, descriptionText: string) => `
You classify whether a job posting is a real listing or a teaser with almost no information.

Company: ${companyName}
Title: ${jobTitle}
Text:
---
${descriptionText.slice(0, 6000)}
---

Return ONLY valid JSON (no markdown fences): {"listing_quality":"ok"} if the text describes the role, duties, or requirements beyond a generic "apply to learn more" CTA.
{"listing_quality":"placeholder"} if there is no substantive job content (only apply prompts, empty marketing shell, or under ~2 sentences with no role detail).

Be strict about teasers; when uncertain, prefer "placeholder".
`.trim();

/**
 * Cheap follow-up for rows that already have cached AI extraction from before listing_quality existed.
 */
export async function classifyListingQuality(
  apiKey: string,
  companyName: string,
  jobTitle: string,
  descriptionRaw: string
): Promise<ListingQuality> {
  const descriptionText = htmlToText(descriptionRaw);
  const h = heuristicListingQuality(descriptionRaw);
  if (h === "placeholder") return "placeholder";
  const raw = await callGemini(apiKey, LISTING_QUALITY_CLASSIFY_PROMPT(companyName, jobTitle, descriptionText), 256);
  const cleaned = raw.replace(/^```json\s*/i, "").replace(/\s*```$/i, "").trim();
  let parsed: { listing_quality?: unknown };
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return "ok";
  }
  if (parsed.listing_quality === "placeholder") return "placeholder";
  return "ok";
}

// ─────────────────────────────────────────────────────────────────────────────
// Company description extraction
// ─────────────────────────────────────────────────────────────────────────────

const COMPANY_DESCRIPTION_PROMPT = (companyName: string, contextText: string) => `
You are an assistant that writes factual one-sentence company descriptions.

Company name: ${companyName}

Context (from a job posting by this company):
---
${contextText.slice(0, 4000)}
---

Write ONE sentence that directly describes what ${companyName} is and what it does. 
Do not use marketing language. Do not start with "A company that..." — name the company directly.
Do not invent facts not supported by the context.

Return ONLY valid JSON:
{ "description": "<one sentence>" }
`.trim();

/**
 * Generate a one-sentence company description from job description context.
 * Used by the enrichment layer when a company record lacks a description.
 */
export async function extractCompanyDescription(
  apiKey: string,
  companyName: string,
  contextText: string
): Promise<string> {
  const text = htmlToText(contextText);
  const prompt = COMPANY_DESCRIPTION_PROMPT(companyName, text);
  const raw = await callGemini(apiKey, prompt);

  const cleaned = raw.replace(/^```json\s*/i, "").replace(/\s*```$/i, "").trim();

  let parsed: { description?: string };
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`Failed to parse company description JSON: ${cleaned.slice(0, 200)}`);
  }

  return typeof parsed.description === "string" ? parsed.description : "";
}
