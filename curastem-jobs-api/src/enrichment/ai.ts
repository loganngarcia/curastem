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

interface GeminiContent {
  parts: Array<{ text: string }>;
}

interface FunctionDeclaration {
  name: string;
  description: string;
  parameters: {
    type: string;
    properties: Record<string, { type: string; description?: string; enum?: string[] }>;
    required: string[];
  };
}

interface GeminiRequest {
  contents: GeminiContent[];
  tools?: Array<{ functionDeclarations: FunctionDeclaration[] }>;
  toolConfig?: {
    functionCallingConfig: { mode: "AUTO" | "NONE" | "ANY" };
  };
  generationConfig?: {
    // responseMimeType is intentionally omitted — incompatible with function calling
    temperature?: number;
    maxOutputTokens?: number;
  };
}

interface GeminiResponsePart {
  text?: string;
  functionCall?: {
    name: string;
    args: Record<string, unknown>;
  };
}

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: GeminiResponsePart[];
    };
  }>;
}

async function callGemini(apiKey: string, prompt: string): Promise<string> {
  const url = `${GEMINI_API_BASE}/models/${MODEL}:generateContent?key=${apiKey}`;
  const body: GeminiRequest = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 1024,
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

// ─── Salary extraction tool ───────────────────────────────────────────────────

const SALARY_TOOL: FunctionDeclaration = {
  name: "report_salary",
  description:
    "Call this ONLY when the job description contains explicit salary or compensation figures. " +
    "Convert any non-USD currency to USD using current exchange rates. " +
    "If a range is given (e.g. $100k–$150k), report only the minimum.",
  parameters: {
    type: "object",
    properties: {
      minimum_usd: {
        type: "number",
        description: "The minimum salary amount in USD. For hourly/monthly keep the per-period amount, do not annualize.",
      },
      period: {
        type: "string",
        enum: ["year", "month", "hour"],
        description: "The pay period that minimum_usd represents.",
      },
    },
    required: ["minimum_usd", "period"],
  },
};

interface SalaryToolArgs {
  minimum_usd: number;
  period: "year" | "month" | "hour";
}

interface GeminiWithToolsResult {
  text: string;
  salaryArgs: SalaryToolArgs | null;
}

async function callGeminiWithTools(
  apiKey: string,
  prompt: string
): Promise<GeminiWithToolsResult> {
  const url = `${GEMINI_API_BASE}/models/${MODEL}:generateContent?key=${apiKey}`;
  const body: GeminiRequest = {
    contents: [{ parts: [{ text: prompt }] }],
    tools: [{ functionDeclarations: [SALARY_TOOL] }],
    toolConfig: { functionCallingConfig: { mode: "AUTO" } },
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 2048,
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
  const parts = data.candidates?.[0]?.content?.parts ?? [];

  const textPart = parts.find((p) => p.text);
  const funcPart = parts.find((p) => p.functionCall?.name === "report_salary");

  if (!textPart?.text) throw new Error("Gemini returned no text content");

  const salaryArgs = funcPart?.functionCall
    ? (funcPart.functionCall.args as unknown as SalaryToolArgs)
    : null;

  return { text: textPart.text, salaryArgs };
}

// ─────────────────────────────────────────────────────────────────────────────
// Job description extraction
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
  "job_summary": "<one sentence: what the company does> <one sentence: what this role involves>",
  "responsibilities": ["<bullet>", ...],
  "minimum_qualifications": ["<bullet>", ...],
  "preferred_qualifications": ["<bullet>", ...]
}

Rules:
- job_summary must be exactly two sentences: sentence 1 describes the company, sentence 2 describes the role.
- Each array item must be a concise, standalone point. No raw HTML.
- Return empty arrays [] for any section not clearly present in the source text.
- Do NOT invent information not present in the text.

Additionally: if the description contains explicit salary or compensation figures,
call the report_salary tool with the minimum amount converted to USD.
If no salary figures appear anywhere in the text, do not call the tool.
`.trim();

export interface ExtractedJobFields {
  job_summary: string;
  job_description: JobDescriptionExtracted;
  /** Populated only when the model finds explicit salary figures in the description. */
  salary_min: number | null;
  salary_currency: string | null;
  salary_period: import("../types.ts").SalaryPeriod | null;
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
 * Uses Gemini function calling — the model calls report_salary only when salary data
 * is explicitly present in the text. Single API call covers all three fields.
 */
export async function extractJobFields(
  apiKey: string,
  companyName: string,
  jobTitle: string,
  descriptionRaw: string
): Promise<ExtractedJobFields> {
  const descriptionText = htmlToText(descriptionRaw);
  const prompt = JOB_EXTRACTION_PROMPT(companyName, jobTitle, descriptionText);
  const { text, salaryArgs } = await callGeminiWithTools(apiKey, prompt);

  const cleaned = text.replace(/^```json\s*/i, "").replace(/\s*```$/i, "").trim();

  let parsed: {
    job_summary?: string;
    responsibilities?: unknown[];
    minimum_qualifications?: unknown[];
    preferred_qualifications?: unknown[];
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

  return {
    job_summary: typeof parsed.job_summary === "string" ? parsed.job_summary : "",
    job_description: {
      responsibilities: ensureStringArray(parsed.responsibilities),
      minimum_qualifications: ensureStringArray(parsed.minimum_qualifications),
      preferred_qualifications: ensureStringArray(parsed.preferred_qualifications),
    },
    salary_min: salaryArgs?.minimum_usd ?? null,
    salary_currency: salaryArgs ? "USD" : null,
    salary_period: salaryArgs?.period ?? null,
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
