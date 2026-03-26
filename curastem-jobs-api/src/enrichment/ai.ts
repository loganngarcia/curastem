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

import type { JobDescriptionExtracted, PublicSalary, SalaryPeriod } from "../types.ts";
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
    /** Forces JSON-only output — model skips format-decision overhead. */
    response_mime_type?: string;
    /** Explicitly disable thinking — keeps extraction fast and cheap. thinkingBudget: 0 = off. */
    thinkingConfig?: { thinkingBudget: number };
  };
}

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
}

async function callGemini(apiKey: string, prompt: string, maxOutputTokens = 900): Promise<string> {
  const url = `${GEMINI_API_BASE}/models/${MODEL}:generateContent?key=${apiKey}`;
  const body: GeminiRequest = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens,
      // JSON mode: model outputs pure JSON without format-decision overhead.
      // ~20-30% faster generation; our delimiter parser still handles edge cases.
      response_mime_type: "application/json",
      // thinkingBudget: 0 pins thinking off — Flash-Lite supports it but we
      // never want it for pure extraction (adds latency + cost, zero benefit).
      thinkingConfig: { thinkingBudget: 0 },
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

// Delimiter tokens used to wrap the JSON payload in the model response.
// They allow robust extraction even when the model adds prose before/after.
const JSON_START = "<<<JOB_DATA>>>";
const JSON_END   = "<<<END_JOB_DATA>>>";

const JOB_EXTRACTION_PROMPT = (companyName: string, jobTitle: string, descriptionText: string, sourceLocations: string[]) => `
Extract structured data from this job posting. Return only the JSON object below — no prose, no markdown.

Company: ${companyName}
Title: ${jobTitle}
${sourceLocations.length > 0 ? `ATS locations (hints for city/state/country): ${sourceLocations.join(", ")}` : ""}

Description:
---
${descriptionText.slice(0, 8000)}
---

{
  "job_summary": "<2 sentences: company description, then role description>",
  "responsibilities": ["<concise bullet>"],
  "minimum_qualifications": ["<concise bullet>"],
  "preferred_qualifications": ["<concise bullet>"],
  "workplace_type": "remote|hybrid|on_site|null",
  "employment_type": "full_time|part_time|contract|internship|temporary|null",
  "seniority_level": "new_grad|entry|mid|senior|staff|manager|director|executive|null",
  "description_language": "<ISO 639-1>|null",
  "visa_sponsorship": "yes|no|null",
  "salary_min": <number|null>,
  "salary_max": <number|null>,
  "salary_period": "year|month|hour|null",
  "experience_years_min": <integer|null>,
  "locations": ["City, ST" or "City, Country"],
  "job_address": "<street address from description body>|null",
  "job_city": "<full city name>|null",
  "job_state": "<2-letter US state>|null",
  "job_country": "<ISO-2 country code>|null"
}

Rules:
- workplace_type: "remote" = 100% remote, no office. "hybrid" = has specific city + some remote, or "X days in office". "on_site" = in-person only. If a physical location is given alongside remote, use "hybrid" not "remote". null = not mentioned.
- employment_type: "full_time" includes "Regular"/"Permanent"/no qualifier. "contract" includes freelance/C2C/1099/fixed-term. null = genuinely ambiguous.
- seniority_level: "new_grad" only if explicitly targeting new graduates. "Junior"/"Associate" = entry. IC roles with "Manager" in title = not manager seniority. null = not enough info.
- salary: USD numbers only, exact as stated. Do NOT annualize. null if not mentioned.
- experience_years_min: lowest number from ranges ("2-5 years" → 2, "5+ years" → 5). null if not mentioned.
- locations: city-level only ("City, ST" for US, "City, Country" for intl). Never include street addresses or road suffixes. Prefer ATS location hints over job title text. "Remote" only if truly 100% remote.
- job_address: only if a full street address appears in the description body — never from the job title.
- job_city/job_state/job_country: prefer ATS location hints. job_state = 2-letter US abbrev only. job_country = ISO-2 (e.g. "US", "GB").
- Empty arrays [] for missing sections. null for missing scalar fields. Do not invent facts.
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
  salary_max: number | null;
  salary_currency: string | null;
  salary_period: import("../types.ts").SalaryPeriod | null;
  /** Minimum years of experience required; e.g. "2-3 years" → 2. */
  experience_years_min: number | null;
  /** Normalized locations extracted from the posting; first entry is primary. */
  locations: string[] | null;
  /** Street address extracted from posting text. */
  job_address: string | null;
  /** Normalized city extracted from posting text. */
  job_city: string | null;
  /** US state abbreviation (e.g. "CA", "IN") — null for non-US jobs. */
  job_state: string | null;
  /** Country from posting text (ISO-2 or full name). */
  job_country: string | null;
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
 * Build the public salary object from D1 columns — supports min-only, max-only,
 * and min–max ranges when the ATS provides them.
 */
export function buildPublicSalary(row: {
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string | null;
  salary_period: string | null;
}): PublicSalary | null {
  const p = row.salary_period;
  if (p !== "year" && p !== "month" && p !== "hour") return null;
  const period = p as SalaryPeriod;
  const min = row.salary_min;
  const max = row.salary_max;
  if (min === null && max === null) return null;

  const currency = row.salary_currency ?? "USD";
  const nf = (n: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(n);

  let display: string;
  if (min !== null && max !== null && max > min) {
    display = `${nf(min)}–${nf(max)}${period === "year" ? "" : `/${period}`}`;
  } else if (min !== null) {
    const base = formatSalaryDisplay(min, period);
    display = `${base}+`;
  } else {
    display = `Up to ${nf(max!)}${period === "year" ? "" : `/${period}`}`;
  }

  return { min, max, currency, period, display };
}

/**
 * Extract the JSON payload from a Gemini response that may contain delimiter
 * markers (<<<JOB_DATA>>> / <<<END_JOB_DATA>>>), markdown code fences, or
 * raw JSON. Returns the first valid JSON object found in the response.
 */
function extractJsonFromResponse(raw: string): string {
  // Primary: delimiter block
  const delimMatch = raw.match(/<<<JOB_DATA>>>\s*([\s\S]*?)\s*<<<END_JOB_DATA>>>/);
  if (delimMatch) return delimMatch[1].trim();

  // Fallback: strip markdown code fences
  const fenceStripped = raw.replace(/^```(?:json)?\s*/im, "").replace(/\s*```\s*$/im, "").trim();

  // Fallback: find outermost `{ ... }` block
  const braceStart = fenceStripped.indexOf("{");
  const braceEnd   = fenceStripped.lastIndexOf("}");
  if (braceStart !== -1 && braceEnd > braceStart) {
    return fenceStripped.slice(braceStart, braceEnd + 1);
  }

  return fenceStripped;
}

/**
 * Post-process AI workplace_type: if the job has specific physical locations
 * AND the AI said "remote", demote to "hybrid" because a real-office location
 * means it cannot be fully remote.
 */
function reconcileWorkplaceType(
  workplaceType: import("../types.ts").WorkplaceType | null,
  locations: string[]
): import("../types.ts").WorkplaceType | null {
  if (workplaceType !== "remote") return workplaceType;
  // Physical locations other than "Remote" are present
  const hasPhysicalLocation = locations.some(
    (l) => l.toLowerCase() !== "remote" && l.trim() !== ""
  );
  if (hasPhysicalLocation) return "hybrid";
  return workplaceType;
}

/**
 * Extract job_summary, job_description, and all structured fields from raw
 * description text. Single Gemini call with delimiter-wrapped JSON response.
 */
export async function extractJobFields(
  apiKey: string,
  companyName: string,
  jobTitle: string,
  descriptionRaw: string,
  sourceLocations: string[] = []
): Promise<ExtractedJobFields> {
  const descriptionText = htmlToText(descriptionRaw);
  const prompt = JOB_EXTRACTION_PROMPT(companyName, jobTitle, descriptionText, sourceLocations);
  // 900 tokens covers the full JSON response with headroom; actual output is ~300-500 tokens.
  const raw = await callGemini(apiKey, prompt, 900);

  const cleaned = extractJsonFromResponse(raw);

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
    salary_max?: unknown;
    salary_period?: unknown;
    experience_years_min?: unknown;
    locations?: unknown[];
    job_address?: unknown;
    job_city?: unknown;
    job_state?: unknown;
    job_country?: unknown;
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
  const isValidLangCode = (v: unknown): v is import("../types.ts").DescriptionLanguage =>
    typeof v === "string" && /^[a-z]{2}$/.test(v);

  const workplaceTypeRaw = WORKPLACE_TYPES.includes(parsed.workplace_type as never)
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
  const salaryMax = typeof parsed.salary_max === "number" && parsed.salary_max > 0
    ? parsed.salary_max
    : null;
  const salaryPeriod = (salaryMin !== null || salaryMax !== null) &&
    (parsed.salary_period === "year" || parsed.salary_period === "month" || parsed.salary_period === "hour")
    ? (parsed.salary_period as import("../types.ts").SalaryPeriod)
    : null;

  const experienceYearsMin = typeof parsed.experience_years_min === "number" && parsed.experience_years_min > 0
    ? Math.floor(parsed.experience_years_min)
    : null;

  const locations = ensureStringArray(parsed.locations);

  // Reconcile workplace_type: demote "remote" → "hybrid" when a physical location is present
  const workplaceType = reconcileWorkplaceType(workplaceTypeRaw, locations);

  const jobAddress = typeof parsed.job_address === "string" && parsed.job_address.trim()
    ? parsed.job_address.trim()
    : null;
  const jobCity = typeof parsed.job_city === "string" && parsed.job_city.trim()
    ? parsed.job_city.trim()
    : null;
  const jobState = typeof parsed.job_state === "string" && parsed.job_state.trim()
    ? parsed.job_state.trim().toUpperCase().slice(0, 2)  // enforce 2-letter abbreviation
    : null;
  const jobCountry = typeof parsed.job_country === "string" && parsed.job_country.trim()
    ? parsed.job_country.trim()
    : null;

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
    salary_max: salaryMax,
    salary_currency: (salaryMin !== null || salaryMax !== null) ? "USD" : null,
    salary_period: salaryPeriod,
    experience_years_min: experienceYearsMin,
    locations: locations.length > 0 ? locations : null,
    job_address: jobAddress,
    job_city: jobCity,
    job_state: jobState,
    job_country: jobCountry,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Company description extraction
// ─────────────────────────────────────────────────────────────────────────────

const COMPANY_DESCRIPTION_PROMPT = (companyName: string, contextText: string) => `
You are an assistant that writes factual one-sentence company descriptions.

Company name: ${companyName}

Context (from a job posting by this company):
---
${contextText.slice(0, 2000)}
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
