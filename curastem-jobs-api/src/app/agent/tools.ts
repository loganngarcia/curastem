import {
  getJobById,
  listJobs,
  listJobsNear,
  type ListJobsRow,
} from "../../shared/db/queries.ts";
import type { Env, PublicJob, VisaSponsorship } from "../../shared/types.ts";
import { rowToPublicJob } from "../../public/routes/jobs.ts";
import { fetchAgentPlatform } from "../../shared/utils/agentPlatform.ts";
import { estimateTokenUsageCost } from "../../shared/utils/publicBilling.ts";
import type {
  AgentFunctionDeclaration,
  AgentJobSnippet,
  AgentToolName,
  AgentToolResult,
} from "./types.ts";

const SEARCH_JOBS_MAX_POSTED_DAYS = 30;
const AGENT_MODEL = "gemini-3.1-flash-lite-preview";
const DOC_HTML_RULES = `<h1> for title and section headings, <p>, <ul>/<li>, <b>/<strong>, <a>. No markdown. Keep the document concise enough to fit one page as a PDF.`;
const DOC_EDITOR_HTML_BLOCK_RULES = `<h1> or <h1 class="doc-block-title"> (title); <h1 class="doc-block-section"> (sections); <p>, <ul>/<li>, <b>/<strong>, <a>. No <h2>-<h4>.`;
const CREATE_RESUME_HTML_FORMAT_INSTRUCTIONS = `${DOC_EDITOR_HTML_BLOCK_RULES}

Full HTML resume, in order:

1. <h1> or <h1 class="doc-block-title"> — Name
2. <p> — Contact on one line; separate items with space · space. Copy verbatim from the source. Use <a href="..."> for URLs and mailto: for emails. Do not invent contacts.
3. <h1 class="doc-block-section">Experience</h1> — Newest job first. Per job: <p><b>Title</b> · Company · Dates</p> then <ul><li>achievements</li></ul>. Job title and dates stay in the <p>, not in <li>. No nested lists. You may rewrite bullets for clarity and keyword alignment with the role (when a job is in context, match the posting where it helps). Keep every concrete metric accurate (percentages, dollar amounts, counts, multiples, time ranges) — do not drop or soften numbers.
4. <h1 class="doc-block-section">Education</h1> — <ul>, one <li> per degree
5. <h1 class="doc-block-section">Skills</h1> — 2–3 <p> lines by category. Each: <p><b>Category:</b> comma-separated items</p> (e.g. <b>Software:</b> …, <b>Communication:</b> …). If a job posting or role is in context, only include skills that match what the posting asks for, or that are a reasonable fit from the title, duties, and what you know about the company; leave out unrelated skills. With no job target, use categories that reflect the full resume.

<b> only in experience job headers and skill category labels. No <i>. Complete sections.
Return only the document body HTML fragment. Do not include <!DOCTYPE>, <html>, <head>, <body>, <style>, CSS, scripts, markdown, or code fences.`;
const CAREER_COLLEGE_RESOURCES = [
  { title: "ADPList", url: "https://adplist.org", category: "mentorship", description: "1:1 long-term mentorship from people at top companies." },
  { title: "LinkedIn", url: "https://linkedin.com", category: "career", description: "Networking and job search." },
  { title: "Curastem", url: "https://curastem.org", category: "career", description: "Resumes and mentor connections." },
  { title: "FAFSA", url: "https://fafsa.gov", category: "financial_aid", description: "Free grants and low-interest loans. Avoid private loans and paid scholarships." },
  { title: "Department of Rehabilitation", url: "https://dor.ca.gov", category: "financial_aid", description: "Tuition support, laptops, textbooks, and school/work supplies." },
  { title: "VA Disability Claim", url: "https://va.gov/disability/file-disability-claim-form-21-526ez/introduction", category: "financial_aid", description: "Veterans disability benefits that can support tuition, housing, and monthly cash assistance." },
  { title: "Assist.org", url: "https://assist.org", category: "school_transfer", description: "Check whether community college classes transfer." },
  { title: "Rate My Professors", url: "https://ratemyprofessors.com", category: "school_transfer", description: "Professor ratings before enrolling." },
  { title: "College Scorecard", url: "https://collegescorecard.ed.gov/search/?page=0&search=example+text", category: "school_transfer", description: "Salary outcomes after graduating." },
  { title: "NewGrad Jobs", url: "https://newgrad-jobs.com", category: "jobs_internships", description: "Real-time job postings with email alerts." },
  { title: "New-Grad Positions", url: "https://github.com/SimplifyJobs/New-Grad-Positions", category: "jobs_internships", description: "Early career tech jobs." },
  { title: "Summer 2026 Internships", url: "https://github.com/SimplifyJobs/Summer2026-Internships", category: "jobs_internships", description: "Internship postings for students." },
  { title: "Simplify Jobs", url: "https://chromewebstore.google.com/detail/pbanhockgagggenencehbnadejlgchfc", category: "jobs_internships", description: "Auto-fill job applications with AI." },
  { title: "Recruiter Search", url: "https://google.com/search?q=site:linkedin.com/in+(%22Recruiter%22+OR+%22Talent+Acquisition%22)+(%22Google%22+OR+%22Microsoft%22)", category: "jobs_internships", description: "Find early career recruiters and hiring managers." },
  { title: "Luma", url: "https://luma.com", category: "events_networking", description: "Tech and healthcare events in major cities." },
  { title: "ChatGPT", url: "https://chatgpt.com", category: "ai_productivity", description: "AI assistant with strong context memory." },
  { title: "Otter", url: "https://otter.ai", category: "ai_productivity", description: "Free live captions and AI meeting summaries." },
  { title: "ChatGPT Atlas", url: "https://chatgpt.com/atlas", category: "ai_productivity", description: "AI browser for homework, applying for jobs, and networking." },
  { title: "Gemini in Chrome", url: "https://gemini.google/overview/gemini-in-chrome", category: "ai_productivity", description: "AI help inside Chrome." },
  { title: "Framer Templates", url: "https://framer.com/marketplace/templates/category/free-website-templates", category: "websites_creative", description: "Free websites and portfolios with AI." },
  { title: "Google Gemini", url: "https://gemini.google", category: "websites_creative", description: "Professional headshots, images, videos, posters, and slideshows." },
  { title: "Squarespace Domains", url: "https://squarespace.com", category: "websites_creative", description: "Domains from $10/year." },
  { title: "Shopify", url: "https://shopify.com", category: "websites_creative", description: "Sell physical and digital products." },
  { title: "Stripe", url: "https://stripe.com", category: "websites_creative", description: "Accept payments for products and services." },
  { title: "Google Photos", url: "https://photos.google.com", category: "websites_creative", description: "Free AI photo editing." },
  { title: "SNAP State Directory", url: "https://fns.usda.gov/snap/state-directory", category: "food_supplies", description: "Food benefits that can provide free groceries." },
  { title: "Amazon", url: "https://amazon.com", category: "food_supplies", description: "Free 30-day returns for school supplies." },
  { title: "Microsoft 365 Student", url: "https://microsoft.com/en-us/microsoft-365/college-student-pricing", category: "student_offers", description: "Student offers including Microsoft 365 and LinkedIn Premium Career." },
  { title: "Google Gemini Students", url: "https://gemini.google/students", category: "student_offers", description: "Student offer for Gemini AI." },
  { title: "Cursor Students", url: "https://cursor.com/students", category: "student_offers", description: "Student offer for Cursor coding AI." },
  { title: "Framer Education", url: "https://framer.com/education/students", category: "student_offers", description: "Free Framer and custom domain for eligible students." },
  { title: "Apple Education Store", url: "https://apple.com/us-edu/store", category: "student_offers", description: "Education pricing for computers and iPads." },
  { title: "Apple Music Student", url: "https://offers.applemusic.apple/student-offer", category: "student_offers", description: "Apple Music and Apple TV student offer." },
  { title: "Amazon Student", url: "https://amazon.com/Amazon-Student/b?node=668781011", category: "student_offers", description: "Amazon Prime student offer." },
];

export const AGENT_TOOL_DECLARATIONS: AgentFunctionDeclaration[] = [
  {
    name: "search_jobs",
    description: [
      "Search Curastem's live job listings and return job card events. Use only when the user's latest message asks to find/search/show/list/browse jobs, roles, openings, or internships.",
      "Do not use for greetings, small talk, profile discussion, or general career conversation unless the user asks for listings.",
      "If the user names a role, set query; if they want any role or all openings, omit query and keywords.",
      'Preserve negative title terms in query with a leading dash, e.g. "product manager, software engineer, -senior" excludes titles containing senior.',
      "Never add seniority, stacks, or resume/profile terms unless the user asked. Omit seniority_level unless it is an inclusion filter.",
      "Resume/profile context is optional; do not ask for it before a straightforward search. Use company for employer slugs. Use location_or for multiple metros. Results are returned as job card events.",
    ].join(" "),
    parameters: {
      type: "OBJECT",
      properties: {
        query: { type: "STRING" },
        keywords: { type: "STRING" },
        company: { type: "STRING" },
        location: { type: "STRING" },
        location_or: { type: "STRING" },
        employment_type: { type: "STRING" },
        workplace_type: { type: "STRING" },
        seniority_level: { type: "STRING" },
        posted_within_days: { type: "NUMBER" },
        salary_min: { type: "NUMBER" },
        visa_sponsorship: { type: "STRING" },
        description_language: { type: "STRING" },
        country: { type: "STRING" },
        exclude_ids: { type: "STRING" },
        near_lat: { type: "NUMBER" },
        near_lng: { type: "NUMBER" },
        radius_km: { type: "NUMBER" },
        exclude_remote: { type: "BOOLEAN" },
        limit: { type: "NUMBER" },
        cursor: { type: "STRING" },
      },
      required: [],
    },
  },
  {
    name: "get_job_details",
    description:
      "Fetch full details about a specific job for the model to read. This is data-only and does not control or open anything on the user's screen. To visibly show a job in the user's side panel, call open_job_details instead.",
    parameters: {
      type: "OBJECT",
      properties: {
        job_id: { type: "STRING" },
      },
      required: ["job_id"],
    },
  },
  {
    name: "open_job_details",
    description:
      "Control the user's screen by opening the job details side panel for a specific job. Use when the user asks to open, show, view, pull up, or display a listed/current job, including 'the first one' or 'this job'. Returns a screen_open event and job details.",
    parameters: {
      type: "OBJECT",
      properties: {
        job_id: { type: "STRING" },
      },
      required: [],
    },
  },
  {
    name: "open_docs",
    description:
      "Control the user's screen by opening the document editor panel. Use when the user asks to open, show, view, or go to docs/documents/resume/cover-letter editor. This does not create or edit document content.",
    parameters: { type: "OBJECT", properties: {}, required: [] },
  },
  {
    name: "open_maps",
    description:
      "Control the user's screen by opening the jobs map panel. Use when the user asks to open, show, view, or go to the map/maps. Optionally pass company to focus a company if the user names one.",
    parameters: { type: "OBJECT", properties: { company: { type: "STRING" } }, required: [] },
  },
  {
    name: "open_whiteboard",
    description:
      "Control the user's screen by opening the whiteboard canvas. Use when the user asks to open, show, view, or go to the whiteboard. This does not draw or edit shapes.",
    parameters: { type: "OBJECT", properties: {}, required: [] },
  },
  {
    name: "open_app_editor",
    description:
      "Control the user's screen by opening the app editor panel in editor mode. Use when the user asks to open, show, view, or go to the app editor/code editor. This does not create or change app code.",
    parameters: { type: "OBJECT", properties: {}, required: [] },
  },
  {
    name: "create_resume",
    description:
      "Create a polished one-page resume as a Docs document, not as normal chat text. Return a doc_update event so the client opens the document editor and exposes the downloadable PDF. Use when the user explicitly asks to create, write, make, build, tailor, generate, or draft a resume, including resume templates. Optional inputs: resume_text, profile, job_id, job_context, instructions. Saved resume/profile context is helpful but not required; works even with minimal or no personal details by producing a starter resume template.",
    parameters: {
      type: "OBJECT",
      properties: {
        resume_text: { type: "STRING" },
        profile: { type: "OBJECT" },
        job_id: { type: "STRING" },
        job_context: { type: "OBJECT" },
        instructions: { type: "STRING" },
      },
      required: [],
    },
  },
  {
    name: "create_cover_letter",
    description:
      "Create a polished one-page cover letter as a Docs document, not as normal chat text. Return a doc_update event so the client opens the document editor and exposes the downloadable PDF. Use when the user explicitly asks to create, write, make, generate, tailor, or draft a cover letter, including cover letter templates. Optional inputs: resume_text, profile, job_id, job_context, company, role, instructions. Saved resume/profile context is helpful but not required; works even with minimal context.",
    parameters: {
      type: "OBJECT",
      properties: {
        resume_text: { type: "STRING" },
        profile: { type: "OBJECT" },
        job_id: { type: "STRING" },
        job_context: { type: "OBJECT" },
        company: { type: "STRING" },
        role: { type: "STRING" },
        instructions: { type: "STRING" },
      },
      required: [],
    },
  },
  {
    name: "create_doc",
    description:
      "Create a new general Docs document in the UI, not normal chat text. Use for new written artifacts such as essays, papers, templates, notes, plans, drafts, or full-document rewrites that are not clearly edits to the currently open document. If the artifact is a resume use create_resume; if it is a cover letter use create_cover_letter. If the user is changing the current resume, cover letter, or document, prefer edit_doc. Content must be complete HTML using the allowed document tags. Returns a doc_update event so the client opens Docs.",
    parameters: { type: "OBJECT", properties: { content: { type: "STRING" } }, required: ["content"] },
  },
  {
    name: "edit_doc",
    description:
      "Edit the currently open/relevant document, resume, or cover letter without creating a new doc. Use for change a phrase, add a bullet, remove a section, tweak tone, fix typo, shorten, revise, or targeted resume/cover-letter edits. Use exact current HTML/text from document context. Returns a doc_patch event. Operations: replace_exact (find + replace), append_html (html), prepend_html (html), or set_html only when the user explicitly asks to rewrite the current doc.",
    parameters: {
      type: "OBJECT",
      properties: {
        operations: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: {
              op: { type: "STRING" },
              find: { type: "STRING" },
              replace: { type: "STRING" },
              html: { type: "STRING" },
            },
          },
        },
        docType: { type: "STRING" },
      },
      required: ["operations"],
    },
  },
  {
    name: "create_app",
    description:
      "Create a new self-contained HTML/CSS/JS mini app only when the user explicitly asks to build, make, create, code, or generate an interactive tool, game, quiz, or web app. Include embedded CSS/JS, mobile responsive layout, unique ids on interactive elements, accessible states, and no external JS libraries. For changes to the current app, prefer edit_app. Returns an app_update event.",
    parameters: { type: "OBJECT", properties: { code: { type: "STRING" } }, required: ["code"] },
  },
  {
    name: "edit_app",
    description:
      "Edit the currently open/relevant app code without creating a new app. Use for small app changes like changing text, styling, layout, behavior, buttons, validation, or fixing bugs. Use exact current HTML/CSS/JS from app context. Returns an app_patch event. Operations: replace_exact (find + replace), append_code (code), prepend_code (code), or set_code only when the user explicitly asks to rewrite the current app.",
    parameters: {
      type: "OBJECT",
      properties: {
        operations: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: {
              op: { type: "STRING" },
              find: { type: "STRING" },
              replace: { type: "STRING" },
              code: { type: "STRING" },
            },
          },
        },
      },
      required: ["operations"],
    },
  },
  {
    name: "draw_whiteboard",
    description:
      "Add new tldraw-compatible shapes to the whiteboard. Use when the user asks to draw a new diagram, chart, mind map, flowchart, box, arrow, label, or visual element. Do not use to modify existing shapes; use edit_whiteboard for that. Use only geo, text, and arrow shapes with finite x/y/w/h, unique ids/indexes, and arrows anchored through start/end point props. Returns a whiteboard_command event.",
    parameters: { type: "OBJECT", properties: { shapes: { type: "ARRAY", items: { type: "OBJECT" } } }, required: ["shapes"] },
  },
  {
    name: "edit_whiteboard",
    description:
      "Modify existing whiteboard shapes by id. Use when the user asks to move, resize, recolor, relabel, restyle, connect, or remove specific existing shapes from the current canvas. Send only fields to change, or ids to remove, using ids from the canvas snapshot. To add new shapes, use draw_whiteboard. Returns a whiteboard_command event.",
    parameters: { type: "OBJECT", properties: { patches: { type: "ARRAY", items: { type: "OBJECT" } }, remove: { type: "ARRAY", items: { type: "STRING" } } }, required: [] },
  },
  {
    name: "erase_whiteboard",
    description:
      "Delete whiteboard shapes by exact id from the canvas snapshot. For clear/start-over requests, delete all shape ids from the snapshot. Returns a whiteboard_command event.",
    parameters: { type: "OBJECT", properties: { ids: { type: "ARRAY", items: { type: "STRING" } } }, required: ["ids"] },
  },
  {
    name: "retrieve_resources",
    description:
      "Retrieve the full curated career and college resource guide: mentorship, financial aid, transfer planning, job search, internships, networking, AI tools, websites, food support, and student offers.",
    parameters: { type: "OBJECT", properties: {}, required: [] },
  },
  {
    name: "save_resume",
    description: "Save the user's plain-text resume in their Curastem profile when authenticated.",
    parameters: { type: "OBJECT", properties: { content: { type: "STRING" } }, required: ["content"] },
  },
  {
    name: "retrieve_resume",
    description: "Retrieve the authenticated user's saved plain-text resume.",
    parameters: { type: "OBJECT", properties: {}, required: [] },
  },
  {
    name: "retrieve_memories",
    description: "Retrieve the user's saved favorite things/profile memory bullets. These are the same as the app's 'Your favorite things' field and may be local-only when signed out.",
    parameters: { type: "OBJECT", properties: {}, required: [] },
  },
  {
    name: "save_memories",
    description: "Append one concise memory/favorite thing to the user's 'Your favorite things' list. Use when the user explicitly shares a stable preference, interest, goal, or personal fact worth remembering.",
    parameters: { type: "OBJECT", properties: { memory: { type: "STRING" } }, required: ["memory"] },
  },
  {
    name: "edit_memories",
    description: "Edit or delete one memory/favorite thing by numeric index in the user's 'Your favorite things' list.",
    parameters: { type: "OBJECT", properties: { id: { type: "STRING" }, new_text: { type: "STRING" } }, required: ["id"] },
  },
];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringArg(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberArg(args: Record<string, unknown>, key: string): number | undefined {
  const value = args[key];
  if (value == null || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function objectArg(args: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const value = args[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function stripHtml(raw: string): string {
  return raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeDocEditorHtml(raw: string, docType: "resume" | "cover_letter"): string {
  let html = raw.trim();
  html = html.replace(/^```(?:html)?\s*/i, "").replace(/```$/i, "").trim();
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch?.[1]) html = bodyMatch[1].trim();
  html = html
    .replace(/<!doctype[^>]*>/gi, "")
    .replace(/<html[^>]*>|<\/html>/gi, "")
    .replace(/<head[\s\S]*?<\/head>/gi, "")
    .replace(/<meta[^>]*>/gi, "")
    .replace(/<title[\s\S]*?<\/title>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<\/?body[^>]*>/gi, "")
    .trim();
  if (docType === "resume") {
    html = html
      .replace(/<h[2-4][^>]*>\s*(experience|education|skills)\s*<\/h[2-4]>/gi, (_match, title) => `<h1 class="doc-block-section">${title}</h1>`)
      .replace(/<h[2-4][^>]*>/gi, '<h1 class="doc-block-section">')
      .replace(/<\/h[2-4]>/gi, "</h1>")
      .replace(/<i\b[^>]*>/gi, "")
      .replace(/<\/i>/gi, "");
  }
  return html || `<h1>${docType === "resume" ? "Resume" : "Cover Letter"}</h1>`;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function textToSimpleOnePagePdfBase64(text: string): string {
  const lines = text
    .replace(/\r/g, "")
    .split(/\n|(?<=\.)\s+/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 42);
  const escaped = lines.map((line) =>
    line.slice(0, 96).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)")
  );
  let y = 760;
  const content = [
    "BT",
    "/F1 10 Tf",
    "50 760 Td",
    ...escaped.flatMap((line, index) => {
      const op = index === 0 ? [`(${line}) Tj`] : [`0 -16 Td`, `(${line}) Tj`];
      y -= 16;
      return y > 60 ? op : [];
    }),
    "ET",
  ].join("\n");
  const objects = [
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
    "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj",
    "4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj",
    `5 0 obj << /Length ${content.length} >> stream\n${content}\nendstream endobj`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const obj of objects) {
    offsets.push(pdf.length);
    pdf += obj + "\n";
  }
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i < offsets.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return bytesToBase64(new TextEncoder().encode(pdf));
}

function extractUsage(data: any): { input_tokens: number; output_tokens: number; total_tokens: number } {
  const usage = data?.usageMetadata ?? data?.usage_metadata ?? {};
  return {
    input_tokens: Number(usage.promptTokenCount ?? usage.prompt_token_count ?? 0) || 0,
    output_tokens: Number(usage.candidatesTokenCount ?? usage.candidates_token_count ?? 0) || 0,
    total_tokens: Number(usage.totalTokenCount ?? usage.total_token_count ?? 0) || 0,
  };
}

function extractText(data: any): string {
  return data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? "").join("") ?? "";
}

function buildJobsApiTitle(args: Record<string, unknown>): string | undefined {
  const query = stringArg(args, "query") ?? "";
  const keywords = stringArg(args, "keywords") ?? "";
  if (!query && !keywords) return undefined;
  if (!query) return keywords;
  if (!keywords) return query;
  return `${query} ${keywords}`;
}

function postedSinceUnix(raw: unknown): number | undefined {
  if (raw == null || raw === "") return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  const days = Math.min(Math.max(Math.floor(n), 1), SEARCH_JOBS_MAX_POSTED_DAYS);
  return Math.floor(Date.now() / 1000) - days * 86400;
}

function parseCommaList(raw: string | undefined): string[] | undefined {
  const out = raw?.split(",").map((s) => s.trim()).filter(Boolean);
  return out && out.length > 0 ? out : undefined;
}

function publicJobToSnippet(job: PublicJob): AgentJobSnippet {
  return {
    id: job.id,
    title: job.title,
    company: job.company?.name ?? "",
    company_logo: job.company?.logo_url ?? null,
    locations: job.locations ?? null,
    employment_type: job.employment_type ?? null,
    workplace_type: job.workplace_type ?? null,
    seniority_level: job.seniority_level ?? null,
    posted_at: job.posted_at ?? null,
    apply_url: job.apply_url ?? null,
    summary: job.job_summary ?? null,
    salary: job.salary?.display ?? null,
    visa_sponsorship: job.visa_sponsorship ?? null,
  };
}

function rowsToPublicJobs(rows: ListJobsRow[]): PublicJob[] {
  return rows.map(rowToPublicJob);
}

function paramsToArgs(searchParams: URLSearchParams): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  for (const [key, value] of searchParams.entries()) {
    args[key] = value;
  }
  if (searchParams.has("title")) {
    args.query = searchParams.get("title") ?? "";
  }
  return args;
}

export async function executeAgentTool(
  env: Env,
  name: AgentToolName,
  rawArgs: unknown,
  options: { searchParams?: URLSearchParams; selectedJobId?: string | null; userId?: string | null; clientMemories?: string[] } = {}
): Promise<AgentToolResult> {
  const args = options.searchParams ? paramsToArgs(options.searchParams) : asRecord(rawArgs);
  if (name === "search_jobs") return executeSearchJobs(env, args, options.searchParams);
  if (name === "get_job_details") return executeGetJobDetails(env, args, options.selectedJobId);
  if (name === "open_job_details") return executeOpenJobDetails(env, args, options.selectedJobId);
  if (name === "open_docs" || name === "open_maps" || name === "open_whiteboard" || name === "open_app_editor") return executeOpenScreen(name, args);
  if (name === "create_resume" || name === "create_cover_letter") return executeDocumentGeneration(env, name, args, options.selectedJobId);
  if (name === "create_doc") return echoDocUpdate(args, "doc");
  if (name === "edit_doc") return echoDocPatch(args);
  if (name === "create_app") return echoAppUpdate(args);
  if (name === "edit_app") return echoAppPatch(args);
  if (name === "draw_whiteboard" || name === "edit_whiteboard" || name === "erase_whiteboard") return echoWhiteboardCommand(name, args);
  if (name === "retrieve_resources") return retrieveResources();
  if (name === "save_resume") return saveResume(env, options.userId ?? null, args);
  if (name === "retrieve_resume") return retrieveResume(env, options.userId ?? null);
  if (name === "retrieve_memories") return retrieveMemories(env, options.userId ?? null, options.clientMemories);
  if (name === "save_memories") return saveMemory(env, options.userId ?? null, args, options.clientMemories);
  if (name === "edit_memories") return editMemory(env, options.userId ?? null, args, options.clientMemories);
  return {
    events: [{ type: "tool_error", tool: String(name), message: "Unsupported tool" }],
    functionResponse: { error: "unsupported_tool" },
  };
}

async function executeSearchJobs(
  env: Env,
  args: Record<string, unknown>,
  searchParams?: URLSearchParams
): Promise<AgentToolResult> {
  const title = searchParams?.get("title") ?? buildJobsApiTitle(args);
  const q = searchParams?.get("q") ?? undefined;
  const locationOrRaw = searchParams?.get("location_or") ?? stringArg(args, "location_or");
  const excludeIdsRaw = searchParams?.get("exclude_ids") ?? stringArg(args, "exclude_ids");
  const rawLimit = numberArg(args, "limit") ?? Number(searchParams?.get("limit") ?? "");
  const limit = Math.min(Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : 6, 50);
  const nearLat = numberArg(args, "near_lat");
  const nearLng = numberArg(args, "near_lng");
  const radiusKm = numberArg(args, "radius_km") ?? 50;
  const common = {
    title,
    q: title ? undefined : q,
    location: searchParams?.get("location") ?? stringArg(args, "location"),
    location_region: searchParams?.get("location_region") ?? undefined,
    location_or: parseCommaList(locationOrRaw),
    exclude_ids: parseCommaList(excludeIdsRaw),
    employment_type: searchParams?.get("employment_type") ?? stringArg(args, "employment_type"),
    workplace_type: searchParams?.get("workplace_type") ?? stringArg(args, "workplace_type"),
    seniority_level: searchParams?.get("seniority_level") ?? stringArg(args, "seniority_level"),
    description_language: searchParams?.get("description_language") ?? stringArg(args, "description_language"),
    company: searchParams?.get("company") ?? stringArg(args, "company"),
    posted_since: Number(searchParams?.get("since")) || postedSinceUnix(args.posted_within_days),
    salary_min: numberArg(args, "salary_min"),
    country: (searchParams?.get("country") ?? stringArg(args, "country"))?.toUpperCase().slice(0, 2),
    visa_sponsorship: (() : VisaSponsorship | undefined => {
      const value = searchParams?.get("visa_sponsorship") ?? args.visa_sponsorship;
      return value === "yes" || value === "no" ? value : undefined;
    })(),
  };

  const rows =
    nearLat !== undefined && nearLng !== undefined
      ? (
          await listJobsNear(env.JOBS_DB, {
            lat: nearLat,
            lng: nearLng,
            radius_km: Math.min(Math.max(radiusKm, 1), 500),
            exclude_remote: args.exclude_remote !== false,
            limit,
            ...common,
          })
        ).rows
      : (
          await listJobs(env.JOBS_DB, {
            ...common,
            limit,
            cursor: searchParams?.get("cursor") ?? stringArg(args, "cursor"),
          })
        ).rows;

  const snippets = rowsToPublicJobs(rows).map(publicJobToSnippet);
  return {
    events: [
      { type: "job_cards", jobs: snippets },
      {
        type: "assistant_text",
        text:
          snippets.length > 0
            ? `Found ${snippets.length} jobs.`
            : "No jobs found matching those criteria.",
      },
    ],
    functionResponse: {
      total: snippets.length,
      jobs: snippets
        .slice(0, 8)
        .map((j, i) => `${i + 1}. id=${j.id} - ${j.title} at ${j.company}${j.locations?.[0] ? ` - ${j.locations[0]}` : ""}`)
        .join("\n"),
    },
  };
}

async function executeGetJobDetails(
  env: Env,
  args: Record<string, unknown>,
  selectedJobId?: string | null
): Promise<AgentToolResult> {
  const jobId = stringArg(args, "job_id") ?? selectedJobId ?? "";
  if (!jobId) {
    return {
      events: [{ type: "tool_error", tool: "get_job_details", message: "No job ID provided." }],
      functionResponse: { error: "no_job_id" },
    };
  }
  const row = await getJobById(env.JOBS_DB, jobId);
  if (!row) {
    return {
      events: [{ type: "tool_error", tool: "get_job_details", message: "Job not found." }],
      functionResponse: { error: "not_found" },
    };
  }
  const job = rowToPublicJob(row);
  return {
    events: [],
    functionResponse: {
      job: {
        id: job.id,
        title: job.title,
        company: job.company,
        posted_at: job.posted_at,
        locations: job.locations,
        employment_type: job.employment_type,
        workplace_type: job.workplace_type,
        seniority_level: job.seniority_level,
        description_language: job.description_language,
        source_name: job.source_name,
        source_url: job.source_url,
        summary: job.job_summary,
        job_summary: job.job_summary,
        job_description: job.job_description,
        visa_sponsorship: job.visa_sponsorship,
        experience_years_min: job.experience_years_min,
        job_city: job.job_city,
        job_state: job.job_state,
        job_country: job.job_country,
        salary: job.salary,
        apply_url: job.apply_url,
      },
    },
  };
}

async function executeOpenJobDetails(
  env: Env,
  args: Record<string, unknown>,
  selectedJobId?: string | null
): Promise<AgentToolResult> {
  const details = await executeGetJobDetails(env, args, selectedJobId);
  const job = (details.functionResponse.job ?? null) as Record<string, unknown> | null;
  if (!job) {
    return details;
  }
  return {
    events: [
      { type: "screen_open", target: "job_details", job },
      { type: "job_detail", job },
    ],
    functionResponse: {
      ...details.functionResponse,
      opened: "job_details",
    },
  };
}

function executeOpenScreen(name: AgentToolName, args: Record<string, unknown>): AgentToolResult {
  const targetByTool: Partial<Record<AgentToolName, "docs" | "maps" | "whiteboard" | "app_editor">> = {
    open_docs: "docs",
    open_maps: "maps",
    open_whiteboard: "whiteboard",
    open_app_editor: "app_editor",
  };
  const target = targetByTool[name];
  if (!target) {
    return {
      events: [{ type: "tool_error", tool: String(name), message: "Unsupported screen target" }],
      functionResponse: { error: "unsupported_screen_target" },
    };
  }
  const company = target === "maps" ? stringArg(args, "company") ?? null : null;
  return {
    events: [{ type: "screen_open", target, ...(company ? { company } : {}) }],
    functionResponse: { opened: target, ...(company ? { company } : {}) },
  };
}

async function jobContextFromArgs(env: Env, args: Record<string, unknown>, selectedJobId?: string | null): Promise<Record<string, unknown> | null> {
  const explicit = objectArg(args, "job_context");
  if (explicit) return explicit;
  const jobId = stringArg(args, "job_id") ?? selectedJobId;
  if (!jobId) return null;
  const row = await getJobById(env.JOBS_DB, jobId);
  return row ? rowToPublicJob(row) as unknown as Record<string, unknown> : null;
}

async function executeDocumentGeneration(
  env: Env,
  toolName: "create_resume" | "create_cover_letter",
  args: Record<string, unknown>,
  selectedJobId?: string | null
): Promise<AgentToolResult> {
  if (!env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
    return {
      events: [{ type: "tool_error", tool: toolName, message: "Agent Platform credentials not configured" }],
      functionResponse: { error: "agent_platform_not_configured" },
    };
  }
  const jobContext = await jobContextFromArgs(env, args, selectedJobId);
  const resumeText = stringArg(args, "resume_text") ?? "";
  const instructions = stringArg(args, "instructions") ?? "";
  const profile = objectArg(args, "profile") ?? {};
  const prompt =
    toolName === "create_resume"
      ? `Create a polished one-page resume as HTML for the Curastem DocEditor. Follow this exact format:

${CREATE_RESUME_HTML_FORMAT_INSTRUCTIONS}

If user details are sparse, make a useful starter resume with clearly editable placeholders. Do not invent specific employers, schools, dates, links, or metrics.

Profile JSON: ${JSON.stringify(profile).slice(0, 6000)}
Resume text: ${resumeText.slice(0, 12000)}
Target job JSON: ${JSON.stringify(jobContext ?? {}).slice(0, 8000)}
Instructions: ${instructions.slice(0, 2000)}`
      : `Create a polished one-page cover letter as HTML. ${DOC_HTML_RULES}
If user/job details are sparse, make a useful starter cover letter with clearly editable placeholders. Do not invent specific experience, links, or metrics.

Profile JSON: ${JSON.stringify(profile).slice(0, 6000)}
Resume text: ${resumeText.slice(0, 12000)}
Target job JSON: ${JSON.stringify(jobContext ?? {}).slice(0, 8000)}
Company: ${stringArg(args, "company") ?? ""}
Role: ${stringArg(args, "role") ?? ""}
Instructions: ${instructions.slice(0, 2000)}`;

  const model = AGENT_MODEL;
  const resp = await fetchAgentPlatform(env, {
    model,
    action: "generateContent",
    body: {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 4096,
        thinkingConfig: { thinkingBudget: 0 },
      },
    },
  });
  if (!resp.ok) {
    return {
      events: [{ type: "tool_error", tool: toolName, message: `Generation failed (${resp.status})` }],
      functionResponse: { error: "generation_failed" },
    };
  }
  const data = await resp.json();
  const raw = extractText(data).trim();
  const docType = toolName === "create_resume" ? "resume" : "cover_letter";
  const html = normalizeDocEditorHtml(
    raw.includes("<") ? raw : `<h1>${docType === "resume" ? "Resume" : "Cover Letter"}</h1><p>${escapeHtml(raw)}</p>`,
    docType
  );
  const text = stripHtml(html);
  const pdfBase64 = textToSimpleOnePagePdfBase64(text);
  const filename = `${docType.replace("_", "-")}.pdf`;
  const usage = estimateTokenUsageCost(env, model, extractUsage(data));
  return {
    events: [{ type: "doc_update", html, docType, pdf_base64: pdfBase64, pdf_filename: filename }],
    functionResponse: {
      html,
      pdf_base64: pdfBase64,
      pdf_mime: "application/pdf",
      pdf_filename: filename,
    },
    usage,
  };
}

function echoDocUpdate(args: Record<string, unknown>, docType: "doc" | "resume" | "cover_letter"): AgentToolResult {
  const html = stringArg(args, "content") ?? "";
  const pdfBase64 = html ? textToSimpleOnePagePdfBase64(stripHtml(html)) : undefined;
  return {
    events: [{ type: "doc_update", html, docType, pdf_base64: pdfBase64, pdf_filename: `${docType}.pdf` }],
    functionResponse: { html, pdf_base64: pdfBase64, pdf_mime: pdfBase64 ? "application/pdf" : undefined },
  };
}

function echoDocPatch(args: Record<string, unknown>): AgentToolResult {
  const operations = Array.isArray(args.operations)
    ? args.operations.filter((operation): operation is Record<string, unknown> => Boolean(operation) && typeof operation === "object" && !Array.isArray(operation))
    : [];
  const requestedDocType = stringArg(args, "docType");
  const docType =
    requestedDocType === "resume" || requestedDocType === "cover_letter" || requestedDocType === "doc"
      ? requestedDocType
      : undefined;
  return {
    events: [{ type: "doc_patch", operations, docType }],
    functionResponse: { ok: true, operations_count: operations.length },
  };
}

function echoAppUpdate(args: Record<string, unknown>): AgentToolResult {
  const html = stringArg(args, "code") ?? "";
  return {
    events: [{ type: "app_update", html }],
    functionResponse: { html },
  };
}

function echoAppPatch(args: Record<string, unknown>): AgentToolResult {
  const operations = Array.isArray(args.operations)
    ? args.operations.filter((op): op is Record<string, unknown> => Boolean(op && typeof op === "object" && !Array.isArray(op)))
    : [];
  return {
    events: [{ type: "app_patch", operations }],
    functionResponse: { ok: true, operations_count: operations.length },
  };
}

function echoWhiteboardCommand(name: AgentToolName, args: Record<string, unknown>): AgentToolResult {
  const command = { name, args };
  return {
    events: [{ type: "whiteboard_command", command }],
    functionResponse: command,
  };
}

function retrieveResources(): AgentToolResult {
  const content = CAREER_COLLEGE_RESOURCES
    .map((resource) => `[${resource.title}](${resource.url}) - ${resource.description}`)
    .join("\n");
  return {
    events: [{ type: "resources", resources: CAREER_COLLEGE_RESOURCES }],
    functionResponse: { resources: CAREER_COLLEGE_RESOURCES, content },
  };
}

async function saveResume(env: Env, userId: string | null, args: Record<string, unknown>): Promise<AgentToolResult> {
  if (!userId) return { events: [{ type: "tool_error", tool: "save_resume", message: "Sign in to save your resume to your Curastem profile." }], functionResponse: { error: "auth_required" } };
  const content = stringArg(args, "content") ?? "";
  const now = Math.floor(Date.now() / 1000);
  await env.JOBS_DB.prepare(
    `INSERT INTO profile (user_id, resume_plain, resume_doc_html, updated_at)
     VALUES (?, ?, NULL, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       resume_plain = excluded.resume_plain,
       resume_doc_html = NULL,
       updated_at = excluded.updated_at`
  ).bind(userId, content, now).run();
  return { events: [{ type: "resume_update", content }], functionResponse: { saved: true } };
}

async function retrieveResume(env: Env, userId: string | null): Promise<AgentToolResult> {
  if (!userId) return { events: [{ type: "tool_error", tool: "retrieve_resume", message: "Sign in to retrieve your saved resume from your Curastem profile." }], functionResponse: { error: "auth_required" } };
  const row = await env.JOBS_DB.prepare("SELECT resume_plain, resume_doc_html FROM profile WHERE user_id = ?")
    .bind(userId)
    .first<{ resume_plain: string | null; resume_doc_html: string | null }>();
  const content = row?.resume_plain?.trim()
    ? row.resume_plain
    : row?.resume_doc_html?.trim()
      ? stripHtml(row.resume_doc_html)
      : "";
  return { events: [{ type: "resume_update", content: content || null }], functionResponse: { content } };
}

async function getMemoryList(env: Env, userId: string): Promise<string[]> {
  const row = await env.JOBS_DB.prepare("SELECT you_interests FROM profile WHERE user_id = ?").bind(userId).first<{ you_interests: string | null }>();
  return row?.you_interests?.split("\n").map((s) => s.replace(/^-\s*/, "").trim()).filter(Boolean) ?? [];
}

function normalizeMemoryList(items: string[] | undefined): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const item of items ?? []) {
    const value = item.replace(/^-\s*/, "").trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(value);
  }
  return normalized;
}

async function writeMemoryList(env: Env, userId: string, items: string[]): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await env.JOBS_DB.prepare(
    `INSERT INTO profile (user_id, you_interests, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET you_interests = excluded.you_interests, updated_at = excluded.updated_at`
  ).bind(userId, items.map((s) => `- ${s}`).join("\n"), now).run();
}

async function retrieveMemories(env: Env, userId: string | null, clientMemories?: string[]): Promise<AgentToolResult> {
  const memories = userId ? await getMemoryList(env, userId) : normalizeMemoryList(clientMemories);
  return { events: [{ type: "memory_update", result: { memories } }], functionResponse: { memories } };
}

async function saveMemory(env: Env, userId: string | null, args: Record<string, unknown>, clientMemories?: string[]): Promise<AgentToolResult> {
  const memory = stringArg(args, "memory");
  if (!memory) return { events: [{ type: "tool_error", tool: "save_memories", message: "memory required" }], functionResponse: { error: "memory_required" } };
  const memories = userId ? await getMemoryList(env, userId) : normalizeMemoryList(clientMemories);
  if (!memories.some((m) => m.toLowerCase() === memory.toLowerCase())) memories.push(memory);
  if (userId) await writeMemoryList(env, userId, memories);
  return { events: [{ type: "memory_update", result: { memories } }], functionResponse: { memories } };
}

async function editMemory(env: Env, userId: string | null, args: Record<string, unknown>, clientMemories?: string[]): Promise<AgentToolResult> {
  const index = Number(stringArg(args, "id"));
  const memories = userId ? await getMemoryList(env, userId) : normalizeMemoryList(clientMemories);
  if (!Number.isInteger(index) || index < 0 || index >= memories.length) {
    return { events: [{ type: "tool_error", tool: "edit_memories", message: "invalid memory id" }], functionResponse: { error: "invalid_id" } };
  }
  const replacement = stringArg(args, "new_text");
  if (replacement) memories[index] = replacement;
  else memories.splice(index, 1);
  if (userId) await writeMemoryList(env, userId, memories);
  return { events: [{ type: "memory_update", result: { memories } }], functionResponse: { memories } };
}
