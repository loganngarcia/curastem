import type { Env } from "../../shared/types.ts";
import { fetchGeminiWithFallback } from "../../shared/utils/geminiFetch.ts";
import { reserveGeminiQuota } from "../../shared/utils/geminiQuota.ts";
import { logger } from "../../shared/utils/logger.ts";

const RESUME_MODEL = "gemini-3.1-flash-lite-preview";
const PROCESSING_LOCK_TTL_SECONDS = 5 * 60;
const DIRTY_FLAG_TTL_SECONDS = 5 * 60;

const DOC_EDITOR_HTML_BLOCK_RULES =
  `<h1> or <h1 class="doc-block-title"> (title); <h1 class="doc-block-section"> (sections); <p>, <ul>/<li>, <b>/<strong>, <a>. No <h2>-<h4>.`;

const CREATE_RESUME_HTML_FORMAT_INSTRUCTIONS = `${DOC_EDITOR_HTML_BLOCK_RULES}

Full HTML resume, in order:

1. <h1> or <h1 class="doc-block-title"> — Name
2. <p> — Contact on one line; separate items with space · space. Copy verbatim from the source. Use <a href="..."> for URLs and mailto: for emails. Do not invent contacts.
3. <h1 class="doc-block-section">Experience</h1> — Newest job first. Per job: <p><b>Title</b> · Company · Dates</p> then <ul><li>achievements</li></ul>. Job title and dates stay in the <p>, not in <li>. No nested lists. You may rewrite bullets for clarity and keyword alignment with the role (when a job is in context, match the posting where it helps). Keep every concrete metric accurate (percentages, dollar amounts, counts, multiples, time ranges) — do not drop or soften numbers.
4. <h1 class="doc-block-section">Education</h1> — <ul>, one <li> per degree
5. <h1 class="doc-block-section">Skills</h1> — 2–3 <p> lines by category. Each: <p><b>Category:</b> comma-separated items</p> (e.g. <b>Software:</b> …, <b>Communication:</b> …). If a job posting or role is in context, only include skills that match what the posting asks for, or that are a reasonable fit from the title, duties, and what you know about the company; leave out unrelated skills. With no job target, use categories that reflect the full resume.

<b> only in experience job headers and skill category labels. No <i>. Complete sections.`;

const RESUME_EXTRACTION_PROMPT = `You are parsing a resume. Return ONLY valid JSON, no markdown, no explanation.
Extract this structure:
{
  "fullName": "person name in Title Case (e.g. Logan Garcia) or empty string",
  "school": "most recent school/university or empty string",
  "profileJobTitles": ["1-6 short professional job titles for this person's career search"],
  "interests": ["array of skills, hobbies, interests found - max 10 concise phrases"],
  "resumeText": "the full plain-text content of the resume",
  "seniorityLevel": "one of: intern | new_grad | entry | mid | senior | staff | manager | director | executive - infer from years of total professional experience, job titles, and education. Use intern for students/no experience, new_grad for <1yr, entry for 1-2yr, mid for 3-5yr, senior for 6-9yr, staff for 10+yr individual contributors, manager/director/executive for leadership roles."
}

profileJobTitles rules:
- Return NEXT-job search targets, not every past title. Use Title Case and common industry wording in today's world.
- Base titles on the resume, with 0-2 relevant inferred roles if clearly supported by skills or trajectory.
- Do not include seniority or specialty variants of the same role; use one broad title (e.g. "Product Manager", not also "Senior Product Manager" or "Technical Product Manager").
- Convert internships, campus jobs, and side roles into career-facing titles when appropriate.
- If seniorityLevel is intern, new_grad, or entry and the resume does not clearly target senior/staff/leadership roles, append negative title filters to profileJobTitles after the positive titles. Always include "-senior" and "-staff"; include "-principal", "-manager", or "-director" too if they fit within the max 6 items. These are search filters, not job titles.
- Do not add negative filters for mid, senior, staff, manager, director, or executive profiles.
- Keep titles plain, recognizable, deduped, strongest fit first, max 6.

Keep emails, phones, and URLs in resumeText exactly as printed in the document.`;

const RESUME_GEMINI_SAFETY_SETTINGS = [
  { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
];

type ResumeProfileRow = {
  resume_file_r2_key: string | null;
  resume_file_name: string | null;
  resume_file_mime: string | null;
  resume_doc_html: string | null;
  you_name: string | null;
  you_school: string | null;
  you_work: string | null;
  you_interests: string | null;
};

type ExtractedResumeProfile = {
  fullName?: string;
  school?: string;
  work?: string;
  profileJobTitles?: string[];
  interests?: string[];
  resumeText?: string;
  seniorityLevel?: string;
};

type GeminiResponse = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
};

export type ResumeProcessResult =
  | { status: "missing" }
  | { status: "already_processed"; profile_fields?: ExtractedProfileFields }
  | { status: "already_processing" }
  | { status: "rate_limited"; retry_after_seconds: number }
  | {
      status: "processed";
      resume_text_length: number;
      resume_doc_html_length: number;
      profile_fields: ExtractedProfileFields;
    };

type ExtractedProfileFields = {
  you_name: string | null;
  you_school: string | null;
  you_work: string | null;
  you_interests: string | null;
};

async function markUserDirty(kv: KVNamespace, userId: string): Promise<void> {
  try {
    await kv.put(`sync_dirty:${userId}`, String(Date.now()), {
      expirationTtl: DIRTY_FLAG_TTL_SECONDS,
    });
  } catch {
    // Best-effort. Polling still reconciles if KV is temporarily unavailable.
  }
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function stripLeadingMarkdownFence(text: string): string {
  return text
    .replace(/^```[a-z]*\n?/i, "")
    .replace(/```$/i, "")
    .trim();
}

function geminiText(data: GeminiResponse): string {
  return (
    data.candidates?.[0]?.content?.parts
      ?.map((part) => part.text || "")
      .join("") || ""
  );
}

async function callGemini(env: Env, body: unknown): Promise<string> {
  const res = await fetchGeminiWithFallback(env, RESUME_MODEL, "generateContent", body);
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`Gemini resume API error ${res.status}: ${err.slice(0, 300)}`);
  }
  return geminiText((await res.json()) as GeminiResponse);
}

function parseExtractedResume(rawText: string): ExtractedResumeProfile {
  try {
    const parsed = JSON.parse(stripLeadingMarkdownFence(rawText));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function cleanProfileText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function formatProfileJobTitles(titles: unknown): string | null {
  if (!Array.isArray(titles)) return null;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of titles) {
    if (typeof raw !== "string") continue;
    const label = raw
      .trim()
      .replace(/\s+/g, " ")
      .split(" ")
      .map((word) => (word ? word[0].toUpperCase() + word.slice(1).toLowerCase() : ""))
      .join(" ");
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(label);
    if (out.length >= 6) break;
  }
  return out.length ? out.join(", ") : null;
}

function formatInterests(interests: unknown): string | null {
  if (!Array.isArray(interests)) return null;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of interests) {
    if (typeof raw !== "string") continue;
    const label = raw.trim().replace(/\s+/g, " ");
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(label);
    if (out.length >= 10) break;
  }
  return out.length ? out.join("\n") : null;
}

function profileFieldsFromRow(row: ResumeProfileRow): ExtractedProfileFields {
  return {
    you_name: row.you_name,
    you_school: row.you_school,
    you_work: row.you_work,
    you_interests: row.you_interests,
  };
}

function hasMissingProfileFields(row: ResumeProfileRow): boolean {
  return (
    !row.you_name?.trim() ||
    !row.you_school?.trim() ||
    !row.you_work?.trim() ||
    !row.you_interests?.trim()
  );
}

function extractedFieldsFromResume(
  row: ResumeProfileRow,
  extracted: ExtractedResumeProfile
): ExtractedProfileFields {
  const extractedName = cleanProfileText(extracted.fullName);
  const extractedSchool = cleanProfileText(extracted.school);
  const extractedWork =
    formatProfileJobTitles(extracted.profileJobTitles) ??
    cleanProfileText(extracted.work);
  const extractedInterests = formatInterests(extracted.interests);
  return {
    you_name: row.you_name?.trim() ? row.you_name : extractedName,
    you_school: row.you_school?.trim() ? row.you_school : extractedSchool,
    you_work: row.you_work?.trim() ? row.you_work : extractedWork,
    you_interests: row.you_interests?.trim() ? row.you_interests : extractedInterests,
  };
}

async function extractResumeProfileFields(
  env: Env,
  row: ResumeProfileRow,
  resumeKey: string
): Promise<{ fields: ExtractedProfileFields; resumeText: string }> {
  const obj = await env.USER_FILES.get(resumeKey);
  if (!obj) throw new Error("Resume file missing from R2");
  const fileBytes = await obj.arrayBuffer();
  const base64 = arrayBufferToBase64(fileBytes);
  const mimeType = row.resume_file_mime || "application/pdf";
  const extractRaw = await callGemini(env, {
    contents: [
      {
        parts: [
          { text: RESUME_EXTRACTION_PROMPT },
          { inlineData: { mimeType, data: base64 } },
        ],
      },
    ],
    generationConfig: { temperature: 0, maxOutputTokens: 2048 },
    safetySettings: RESUME_GEMINI_SAFETY_SETTINGS,
  });
  const extracted = parseExtractedResume(extractRaw);
  const resumeText = extracted.resumeText?.trim();
  if (!resumeText) throw new Error("Resume extraction returned empty resumeText");
  return {
    fields: extractedFieldsFromResume(row, extracted),
    resumeText,
  };
}

async function fillMissingProfileFieldsForProcessedResume(
  env: Env,
  userId: string,
  row: ResumeProfileRow,
  resumeKey: string
): Promise<ExtractedProfileFields> {
  if (!hasMissingProfileFields(row)) return profileFieldsFromRow(row);
  const quota = await reserveGeminiQuota(env.RATE_LIMIT_KV, "app_resume_profile_backfill", 1);
  if (!quota.allowed) return profileFieldsFromRow(row);
  const { fields } = await extractResumeProfileFields(env, row, resumeKey);
  const now = Math.floor(Date.now() / 1000);
  await env.JOBS_DB.prepare(
    `UPDATE profile
        SET you_name = CASE WHEN you_name IS NULL OR TRIM(you_name) = '' THEN ? ELSE you_name END,
            you_school = CASE WHEN you_school IS NULL OR TRIM(you_school) = '' THEN ? ELSE you_school END,
            you_work = CASE WHEN you_work IS NULL OR TRIM(you_work) = '' THEN ? ELSE you_work END,
            you_interests = CASE WHEN you_interests IS NULL OR TRIM(you_interests) = '' THEN ? ELSE you_interests END,
            updated_at = ?
      WHERE user_id = ? AND resume_file_r2_key = ?`
  )
    .bind(
      fields.you_name,
      fields.you_school,
      fields.you_work,
      fields.you_interests,
      now,
      userId,
      resumeKey
    )
    .run();
  await markUserDirty(env.RATE_LIMIT_KV, userId);
  return fields;
}

export async function processResumeForUser(
  env: Env,
  userId: string,
  expectedResumeKey?: string
): Promise<ResumeProcessResult> {
  if (!env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
    throw new Error("Agent Platform credentials not configured");
  }

  const row = await env.JOBS_DB.prepare(
    `SELECT resume_file_r2_key, resume_file_name, resume_file_mime,
            resume_doc_html, you_name, you_school, you_work, you_interests
       FROM profile WHERE user_id = ?`
  )
    .bind(userId)
    .first<ResumeProfileRow>();

  const resumeKey = row?.resume_file_r2_key;
  if (!resumeKey) return { status: "missing" };
  if (expectedResumeKey && expectedResumeKey !== resumeKey) return { status: "missing" };
  if (row.resume_doc_html?.trim()) {
    return {
      status: "already_processed",
      profile_fields: await fillMissingProfileFieldsForProcessedResume(
        env,
        userId,
        row,
        resumeKey
      ),
    };
  }

  const lockKey = `resume_processing:${userId}:${await sha256Hex(resumeKey)}`;
  if (await env.RATE_LIMIT_KV.get(lockKey)) {
    return { status: "already_processing" };
  }
  await env.RATE_LIMIT_KV.put(lockKey, String(Date.now()), {
    expirationTtl: PROCESSING_LOCK_TTL_SECONDS,
  });

  try {
    const quota = await reserveGeminiQuota(env.RATE_LIMIT_KV, "app_resume_process", 2);
    if (!quota.allowed) {
      return { status: "rate_limited", retry_after_seconds: quota.retryAfterSeconds };
    }
    const { fields: profileFields, resumeText } =
      await extractResumeProfileFields(env, row, resumeKey);

    const formatPrompt = `Turn the plain resume below into HTML. Output only the HTML (no markdown).

${CREATE_RESUME_HTML_FORMAT_INSTRUCTIONS}

Use the plain text for all resume content. These hints are only for <h1> if the name is unclear (not for contact):
- Name: ${profileFields.you_name?.trim() || row.you_name?.trim() || "(unknown)"}
- School: ${profileFields.you_school?.trim() || row.you_school?.trim() || ""}
- Work: ${profileFields.you_work?.trim() || row.you_work?.trim() || ""}

Plain resume:
${resumeText}`;

    const rawHtml = await callGemini(env, {
      contents: [{ parts: [{ text: formatPrompt }] }],
      generationConfig: { temperature: 0, maxOutputTokens: 8192 },
      safetySettings: RESUME_GEMINI_SAFETY_SETTINGS,
    });
    const html = stripLeadingMarkdownFence(rawHtml);
    if (!html) throw new Error("Resume HTML generation returned empty HTML");

    const now = Math.floor(Date.now() / 1000);
    const result = await env.JOBS_DB.prepare(
      `UPDATE profile
          SET resume_plain = ?,
              resume_doc_html = ?,
              you_name = CASE WHEN you_name IS NULL OR TRIM(you_name) = '' THEN ? ELSE you_name END,
              you_school = CASE WHEN you_school IS NULL OR TRIM(you_school) = '' THEN ? ELSE you_school END,
              you_work = CASE WHEN you_work IS NULL OR TRIM(you_work) = '' THEN ? ELSE you_work END,
              you_interests = CASE WHEN you_interests IS NULL OR TRIM(you_interests) = '' THEN ? ELSE you_interests END,
              updated_at = ?
        WHERE user_id = ? AND resume_file_r2_key = ?`
    )
      .bind(
        resumeText,
        html,
        profileFields.you_name,
        profileFields.you_school,
        profileFields.you_work,
        profileFields.you_interests,
        now,
        userId,
        resumeKey
      )
      .run();

    if ((result.meta?.changes ?? 0) > 0) {
      await markUserDirty(env.RATE_LIMIT_KV, userId);
      return {
        status: "processed",
        resume_text_length: resumeText.length,
        resume_doc_html_length: html.length,
        profile_fields: profileFields,
      };
    }
    return { status: "missing" };
  } finally {
    await env.RATE_LIMIT_KV.delete(lockKey).catch((err) => {
      logger.warn("resume_processing_lock_delete_failed", {
        user_id: userId,
        error: String(err),
      });
    });
  }
}
