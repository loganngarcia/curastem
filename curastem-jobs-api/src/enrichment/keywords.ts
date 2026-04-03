/**
 * Job keyword extraction — the single source of truth for skill/keyword phrases.
 *
 * Design:
 *   - Pure string matching against a curated phrase list. No AI, no network calls.
 *   - Computed on-the-fly in rowToFullPublicJob() from already-available DB fields.
 *   - No DB column — the list is deterministic; redeploying the worker updates all jobs.
 *   - O(n · m) where n = phrase count, m = text length. Microseconds in practice.
 *
 * Usage:
 *   import { extractKeywords } from "./keywords.ts";
 *   const kws = extractKeywords(descriptionRaw, jobDescriptionJson);
 *
 * Public API contract:
 *   Returned as `keywords: string[]` on GET /jobs/:id (detail endpoint only).
 *   Empty array when description is unavailable.
 *
 * Extending the list:
 *   Add phrases here and redeploy. The web client and MCP server receive the
 *   updated list automatically — no changes needed in those projects.
 */

/**
 * Curated phrases to surface as keywords in job descriptions.
 * Sorted longest-first at call time so multi-word phrases win over sub-phrases.
 * Case-insensitive matching; original casing from the list is returned.
 */
export const JOB_HIGHLIGHT_PHRASES: readonly string[] = [
  // Design & UX
  "end-to-end",
  "high-fidelity",
  "customer-centric",
  "interaction design",
  "information architecture",
  "user-centered design",
  "user-focused",
  "user-first",
  "user-centric",
  "UX writing",
  "UX research",
  "UI/UX",
  "UI",
  "UX",
  "Figma",
  "prototyping",
  "prototypes",
  "handoffs",
  "intuitive",
  "user-friendly",
  "design system",
  "design",

  // Cross-functional
  "cross-functional",
  "cross-functionally",
  "open source",
  "stakeholders",
  "stakeholder",
  "product managers",
  "developers",
  "designers",
  "teams",
  "Collaborate",
  "leading",
  "Mentor",
  "mentorship",
  "mentoring",
  "interviews",
  "operations",

  // Strategy & growth
  "strategy",
  "business objectives",
  "business goals",
  "vision",
  "Growth",
  "B2C2B",
  "GTM",
  "revenue",
  "pain points",
  "multi-channel",
  "personas",
  "virality",
  "referral",
  "signup",
  "account",
  "browser",
  "extension",
  "monetization",
  "ROI",
  "KPIs",
  "revenue goals",
  "enterprise",
  "SaaS",
  "B2B",
  "B2C",
  "SMBs",
  "small business",
  "global",
  "local",
  "fintech",
  "crypto",
  "web3",
  "early stage",
  "go-to-market",
  "zero-to-one",
  "0 to 1",
  "0-to-1",
  "M&A",
  "SEC",

  // Data & analytics
  "data-driven",
  "data structures",
  "data modeling",
  "data engineers",
  "data scientists",
  "data science",
  "data synthesis",
  "data quality",
  "analytics",
  "analyze",
  "experimentation",
  "A/B testing",
  "quantitative",
  "qualitative",
  "statistics",
  "EDA",
  "datasets",
  "database",
  "relational",
  "non-relational",
  "dashboards",
  "reporting",
  "trends",
  "forecasting",
  "forecasts",
  "data",
  "budgets",
  "ETL/ELT",
  "Delta Lake",
  "Snowflake",
  "Big Query",
  "Redshift",
  "Spark",
  "SQL",

  // Engineering
  "full-stack",
  "front-end",
  "object-oriented design",
  "design patterns",
  "schema design",
  "query optimization",
  "replication",
  "scalability",
  "large-scale",
  "distributed",
  "scalable",
  "reusability",
  "reusable",
  "architecture",
  "architectures",
  "observability",
  "monitoring",
  "security",
  "cybersecurity",
  "encryption",
  "authentication",
  "hardware",
  "infrastructure",
  "code reviews",
  "CI/CD pipelines",
  "Buildkite",
  "CircleCI",
  "Jenkins",
  "CI/CD",
  "scripts",
  "deploy",
  "production",
  "production-ready",
  "low-latency",
  "real-time",
  "testing",
  "debugging",
  "debug",
  "performance",
  "maintainable",
  "efficient",
  "WebSockets",
  "RESTful APIs",
  "RESTful",
  "API",
  "APIs",
  "pipelines",
  "algorithms",
  "backend",
  "codebase",

  // Mobile
  "SwiftUI",
  "Swift",
  "UIKit",
  "Xcode",
  "iOS",
  "Android",
  "SDK",
  "apps",

  // AI / ML
  "generative AI",
  "AI-powered",
  "machine learning",
  "deep learning",
  "ML models",
  "ML",
  "NLP",
  "computer vision",
  "fine-tuning",
  "PEFT",
  "LoRA",
  "foundation models",
  "MLOps",
  "gradient debugging",
  "distributed training",
  "LLMs",
  "RLHF",
  "SFT",
  "search quality",
  "model selection",
  "multimodal",
  "multi-modal",
  "Diffusion",
  "GNNs",
  "RAG",
  "LangChain",
  "Claude Code",
  "Cursor",
  "MCP",
  "speech-to-text",
  "text-to-speech",
  "storytelling",
  "databases",
  "webhooks",
  "ai agent",
  "Platform",
  "business",
  "dataset",
  "agentic",
  "DevOps",
  "Claude",
  "craft",
  "gRPC",
  "REST",
  "crms",
  "GCP",
  "HCI",
  "Hugging Face",
  "Transformers",
  "PyTorch",
  "TensorFlow",
  "CUDA",
  "GPU",
  "JAX",
  "Pandas",
  "NumPy",
  "Python",
  "agents",
  "vector",
  "latency",
  "accuracy",
  "AI",

  // Languages & frameworks
  "TypeScript",
  "JavaScript",
  "Node.js",
  "React",
  "Vue.js",
  "HTML",
  "CSS",
  "Golang",
  "Scala",
  "Java",
  "Spring Boot",
  "SpringBoot",
  "Kotlin",
  "C++",
  "C+",
  "WebGL",

  // Creative / 3D / games / media
  "visual effects",
  "content creation",
  "Unreal Engine",
  "Unity",
  "AAA",
  "high-poly",
  "characters",
  "animation",
  "rigging",
  "modeling",
  "texturing",
  "lighting",
  "Photoshop",
  "EmberGen",
  "Houdini",
  "streaming",
  "ZBrush",
  "Maya",
  "character",
  "inclusive",
  "emotional",
  "games",
  "VFX",
  "3D",
  "audio",
  "video",
  "art",
  "social",
  "visual",

  // Cloud & infra
  "Kubernetes",
  "Terraform",
  "Kafka",
  "PostgreSQL",
  "MongoDB",
  "n8n",
  "AWS",
  "Azure",
  "Cloudflare",
  "Vercel",
  "Microsoft",
  "Windows",
  "Linux",
  "VMware",
  "Red Hat",
  "Hyper-V",
  "Retool",

  // Retail, visual merchandising & store / field ops
  "Adobe Creative Suite",
  "Point-of-Sale",
  "product placement",
  "driver's license",
  "presentations",
  "merchandise",
  "inventory",
  "Flexible",
  "loyalty",
  "organized",
  "promotions",
  "regional",
  "PowerPoint",
  "writing",
  "clean",
  "web design",

  // Supply chain, QA, office, imaging, networking & hospitality systems
  "Oracle Opera",
  "Quality Assurance",
  "electromagnetics",
  "Supply Chain",
  "MS Office",
  "appointments",
  "radiology",
  "Ethernet",
  "Cloudbeds",
  "Toast",
  "Square",
  "Mews",
  "radiation",
  "plasma",
  "x-rays",
  "Excel",

  // Marketing & sales
  "email marketing",
  "LinkedIn Campaign Manager",
  "campaign management",
  "campaign attribution",
  "funnel optimization",
  "lead follow-up",
  "sales follow-up",
  "outbound",
  "inbound",
  "paid social",
  "landing pages",
  "landing page",
  "A/B testing",
  "segmentations",
  "templates",
  "ABM",
  "MQL",
  "SEO",
  "SEM",
  "UTMs",
  "Salesforce",
  "HubSpot",
  "Marketo",
  "Pardot",
  "6sense",
  "CRM",
  "PRM",
  "pipeline",
  "automation",
  "persona",
  "qualification",
  "processing",
  "routing",
  "marketing",
  "engagement",
  "campaigns",
  "inventory management",
  "outreach",
  "voicemails",
  "receptionist",
  "vendors",
  "email",
  "phone",

  // Product
  "Confluence",
  "Jira",
  "agile",
  "scrum",
  "product direction",
  "product roadmap",
  "product vision",
  "product sense",
  "priorities",
  "standards",
  "feasibility",
  "discovery",
  "launch",
  "roadmaps",
  "empathy",
  "lifecycle management",
  "product development lifecycle",
  "user feedback",
  "user research",
  "user needs",
  "user behavior",
  "customer behavior",
  "customer experience",
  "CX",
  "customer",
  "usability tests",
  "emerging technologies",
  "emerging technology",
  "onboarding",
  "recommendations",
  "workflows",
  "forms",
  "images",
  "website",
  "experiences",

  // AI ethics / safety
  "vulnerabilities",
  "biases",
  "moderation",
  "labeling",
  "ethical",
  "privacy",
  "compliance",
  "regulated",
  "regulatory",
  "Legal",
  "intellectual property",
  "litigation",
  "documentation",

  // Sales
  "Sales",
  "cross-selling",
  "upselling",
  "MEDDPICC",
  "C-suite",
  "CEO",
  "multi-year",
  "negotiation",
  "churn",
  "AE",
  "sales targets",
  "teamwork",
  "attention to detail",
  "high-quality",
  "commercial",
  "distributors",
  "stock",
  "intelligence",
  "speed",
  "competitive",
  "conversion",
  "retention",
  "communication",
  "relationships",

  // Other tech
  "LinkedIn",
  "Google Meet",
  "Zoom",
  "Google",
  "Clay",
  "Unify",
  "spatial",
  "biological",
  "physicochemical",
  "IP",
  "patent",
  "biomaterials",
  "technical constraints",
  "trade-offs",
  "fast-moving",
  "user-facing",
  "internal",
  "external",
  "internally",
  "externally",
  "evaluate",
  "develop",
  "engineering",
  "research",
];

/**
 * Extract matching keywords from a job's text content.
 *
 * Matches phrases case-insensitively against the combined description text.
 * Each phrase is returned at most once, in list order (longest phrases checked first
 * so multi-word phrases aren't shadowed by sub-phrase matches).
 * Returns the original casing from JOB_HIGHLIGHT_PHRASES, not the job text.
 *
 * @param descriptionRaw  Raw HTML/text of the job description (may be null)
 * @param jobDescription  Serialized JSON of JobDescriptionExtracted (may be null)
 */
export function extractKeywords(
  descriptionRaw: string | null,
  jobDescription: string | null
): string[] {
  // Build a single lowercased search corpus from all available text fields
  const parts: string[] = [];
  if (descriptionRaw) parts.push(descriptionRaw);
  if (jobDescription) {
    try {
      const parsed = JSON.parse(jobDescription) as {
        responsibilities?: string[];
        minimum_qualifications?: string[];
        preferred_qualifications?: string[];
      };
      for (const arr of [
        parsed.responsibilities,
        parsed.minimum_qualifications,
        parsed.preferred_qualifications,
      ]) {
        if (Array.isArray(arr)) parts.push(...arr);
      }
    } catch {
      // Malformed JSON — use only descriptionRaw
    }
  }

  if (parts.length === 0) return [];

  const corpus = parts.join(" ").toLowerCase();

  // Longest phrases first to avoid partial matches shadowing full matches
  const sorted = [...JOB_HIGHLIGHT_PHRASES].sort((a, b) => b.length - a.length);

  const matched: string[] = [];
  const seen = new Set<string>();

  for (const phrase of sorted) {
    const key = phrase.toLowerCase();
    if (seen.has(key)) continue;
    // Word-boundary aware: phrase must not be surrounded by alphanumeric chars
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(?<![\\w])${escaped}(?![\\w])`, "i");
    if (re.test(corpus)) {
      matched.push(phrase);
      seen.add(key);
    }
  }

  return matched;
}
