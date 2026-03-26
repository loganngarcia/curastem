/**
 * Exa-powered company enrichment.
 *
 * Two deep passes per company (run-once, tracked by separate timestamp columns):
 *
 *   • Profile deep pass ($0.012) — website, LinkedIn, industry, company type,
 *     employee count, founded year, total funding, HQ city/country/address.
 *     Uses outputSchema with enums — zero regex parsing needed.
 *     Tracked by exa_company_enriched_at. Runs once, never re-runs.
 *
 *   • Social deep pass ($0.012) — X, Instagram, TikTok, GitHub, YouTube,
 *     Glassdoor, Crunchbase, HuggingFace, Facebook.
 *     Tracked by exa_social_enriched_at. Runs once, never re-runs.
 *
 * First-time cost for 1,618 companies: ~$38.83 (1,618 × $0.024).
 * Ongoing cost: only new companies that join the DB.
 */

// ─── Industry taxonomy ────────────────────────────────────────────────────────

/**
 * Canonical industry values. Exa returns free-form text; we normalize it here.
 * Add new entries to INDUSTRY_MAP to handle additional Exa responses.
 */
export type IndustryValue =
  | "software"
  | "ai_ml"
  | "fintech"
  | "healthtech"
  | "edtech"
  | "ecommerce"
  | "retail"
  | "food_beverage"
  | "automotive"
  | "construction"
  | "hospitality"
  | "media"
  | "cybersecurity"
  | "hardware"
  | "aerospace"
  | "energy"
  | "logistics"
  | "real_estate"
  | "consulting"
  | "government"
  | "nonprofit"
  | "gaming"
  | "legal"
  | "manufacturing"
  | "agriculture"
  | "other";

const INDUSTRY_MAP: Record<string, IndustryValue> = {
  // ── Software / Tech ──────────────────────────────────────────────────────────
  "software": "software",
  "saas": "software",
  "internet": "software",
  "technology": "software",
  "information technology": "software",
  "it services": "software",
  "computer software": "software",
  "design services": "software",
  "design software": "software",
  "developer tools": "software",
  "development tools": "software",
  "data analytics": "software",
  "cloud computing": "software",
  "devops": "software",
  "human resources": "software",
  "hr software": "software",
  "hr platform": "software",
  "employer of record": "software",
  "workforce management": "software",
  "talent management": "software",
  // ── AI / ML ──────────────────────────────────────────────────────────────────
  "artificial intelligence": "ai_ml",
  "machine learning": "ai_ml",
  "ai": "ai_ml",
  "ml": "ai_ml",
  "deep learning": "ai_ml",
  "data science": "ai_ml",
  "generative ai": "ai_ml",
  "large language model": "ai_ml",
  "llm": "ai_ml",
  "foundation model": "ai_ml",
  "natural language processing": "ai_ml",
  "nlp": "ai_ml",
  // ── Fintech ──────────────────────────────────────────────────────────────────
  "fintech": "fintech",
  "financial services": "fintech",
  "banking": "fintech",
  "insurance": "fintech",
  "payments": "fintech",
  "finance": "fintech",
  "investment": "fintech",
  "investment management": "fintech",
  "capital markets": "fintech",
  "wealth management": "fintech",
  "accounting": "fintech",
  "tax": "fintech",
  // ── Healthtech / Life Sciences ───────────────────────────────────────────────
  "healthcare": "healthtech",
  "health": "healthtech",
  "biotech": "healthtech",
  "biotechnology": "healthtech",
  "pharmaceutical": "healthtech",
  "pharmaceuticals": "healthtech",
  "medical": "healthtech",
  "medical devices": "healthtech",
  "life sciences": "healthtech",
  "clinical": "healthtech",
  "hospital": "healthtech",
  "hospitals and health care": "healthtech",
  "mental health": "healthtech",
  "dental": "healthtech",
  "veterinary": "healthtech",
  // ── EdTech / Education ───────────────────────────────────────────────────────
  "education": "edtech",
  "edtech": "edtech",
  "e-learning": "edtech",
  "higher education": "edtech",
  "primary education": "edtech",
  "k-12": "edtech",
  "tutoring": "edtech",
  // ── Ecommerce (online-first) ─────────────────────────────────────────────────
  "ecommerce": "ecommerce",
  "e-commerce": "ecommerce",
  "online retail": "ecommerce",
  "marketplace": "ecommerce",
  "direct to consumer": "ecommerce",
  "dtc": "ecommerce",
  // ── Retail (physical / omnichannel) ─────────────────────────────────────────
  "retail": "retail",
  "retail apparel": "retail",
  "apparel": "retail",
  "fashion": "retail",
  "consumer goods": "retail",
  "consumer products": "retail",
  "home improvement": "retail",
  "building materials": "retail",
  "hardware store": "retail",
  "home furnishings": "retail",
  "furniture": "retail",
  "sporting goods": "retail",
  "toy": "retail",
  "toys": "retail",
  "beauty": "retail",
  "cosmetics": "retail",
  "personal care": "retail",
  "pharmacy": "retail",
  "drug stores": "retail",
  "grocery": "retail",
  "supermarket": "retail",
  "convenience stores": "retail",
  "department stores": "retail",
  "wholesale": "retail",
  "dollar store": "retail",
  "luxury goods": "retail",
  "luxury": "retail",
  // ── Food & Beverage ──────────────────────────────────────────────────────────
  "food and beverages": "food_beverage",
  "food & beverages": "food_beverage",
  "food production": "food_beverage",
  "food and beverage": "food_beverage",
  "food & beverage": "food_beverage",
  "food service": "food_beverage",
  "foodservice": "food_beverage",
  "restaurants": "food_beverage",
  "restaurant": "food_beverage",
  "fast food": "food_beverage",
  "quick service restaurant": "food_beverage",
  "qsr": "food_beverage",
  "food manufacturing": "food_beverage",
  "beverages": "food_beverage",
  "brewery": "food_beverage",
  "wine and spirits": "food_beverage",
  "coffee": "food_beverage",
  "bakery": "food_beverage",
  "catering": "food_beverage",
  // ── Automotive ───────────────────────────────────────────────────────────────
  "automotive": "automotive",
  "automobile": "automotive",
  "car dealership": "automotive",
  "motor vehicles": "automotive",
  "auto parts": "automotive",
  "electric vehicles": "automotive",
  "ev": "automotive",
  "mobility": "automotive",
  "autonomous vehicles": "automotive",
  // ── Construction ─────────────────────────────────────────────────────────────
  "construction": "construction",
  "homebuilding": "construction",
  "home building": "construction",
  "architecture": "construction",
  "engineering and construction": "construction",
  "civil engineering": "construction",
  "infrastructure": "construction",
  "facilities": "construction",
  "facilities management": "construction",
  "building services": "construction",
  // ── Hospitality / Travel ─────────────────────────────────────────────────────
  "hospitality": "hospitality",
  "hotels": "hospitality",
  "hotel": "hospitality",
  "travel": "hospitality",
  "tourism": "hospitality",
  "travel and tourism": "hospitality",
  "travel & tourism": "hospitality",
  "leisure": "hospitality",
  "resorts": "hospitality",
  "casinos": "hospitality",
  "cruise": "hospitality",
  "events": "hospitality",
  "event management": "hospitality",
  // ── Media / Entertainment ────────────────────────────────────────────────────
  "media": "media",
  "entertainment": "media",
  "publishing": "media",
  "news": "media",
  "streaming": "media",
  "broadcast": "media",
  "advertising": "media",
  "marketing services": "media",
  "public relations": "media",
  "music": "media",
  "film": "media",
  "animation": "media",
  "sports": "media",
  // ── Cybersecurity ────────────────────────────────────────────────────────────
  "cybersecurity": "cybersecurity",
  "security": "cybersecurity",
  "information security": "cybersecurity",
  "network security": "cybersecurity",
  // ── Hardware / Semiconductors ────────────────────────────────────────────────
  "hardware": "hardware",
  "semiconductors": "hardware",
  "electronics": "hardware",
  "consumer electronics": "hardware",
  "telecom": "hardware",
  "telecommunications": "hardware",
  // ── Aerospace / Defense ──────────────────────────────────────────────────────
  "aerospace": "aerospace",
  "defense": "aerospace",
  "aviation": "aerospace",
  "space": "aerospace",
  // ── Energy ───────────────────────────────────────────────────────────────────
  "energy": "energy",
  "cleantech": "energy",
  "renewable energy": "energy",
  "oil and gas": "energy",
  "utilities": "energy",
  "solar": "energy",
  "wind energy": "energy",
  "nuclear": "energy",
  // ── Logistics / Transportation ───────────────────────────────────────────────
  "logistics": "logistics",
  "supply chain": "logistics",
  "transportation": "logistics",
  "shipping": "logistics",
  "airlines": "logistics",
  "trucking": "logistics",
  "freight": "logistics",
  "delivery": "logistics",
  "last mile": "logistics",
  "warehousing": "logistics",
  // ── Real Estate ──────────────────────────────────────────────────────────────
  "real estate": "real_estate",
  "proptech": "real_estate",
  "commercial real estate": "real_estate",
  "residential real estate": "real_estate",
  "property management": "real_estate",
  // ── Consulting / Professional Services ──────────────────────────────────────
  "consulting": "consulting",
  "professional services": "consulting",
  "staffing": "consulting",
  "management consulting": "consulting",
  "accounting services": "consulting",
  "audit": "consulting",
  // ── Government ───────────────────────────────────────────────────────────────
  "government": "government",
  "public sector": "government",
  "federal": "government",
  "military": "government",
  "public administration": "government",
  // ── Nonprofit ────────────────────────────────────────────────────────────────
  "nonprofit": "nonprofit",
  "non-profit": "nonprofit",
  "ngo": "nonprofit",
  "charity": "nonprofit",
  "foundation": "nonprofit",
  "social enterprise": "nonprofit",
  // ── Gaming ───────────────────────────────────────────────────────────────────
  "gaming": "gaming",
  "video games": "gaming",
  "esports": "gaming",
  "game development": "gaming",
  // ── Legal ────────────────────────────────────────────────────────────────────
  "legal": "legal",
  "law": "legal",
  "law firm": "legal",
  "legaltech": "legal",
  // ── Manufacturing / Industrial ───────────────────────────────────────────────
  "manufacturing": "manufacturing",
  "industrial": "manufacturing",
  "chemical": "manufacturing",
  "chemicals": "manufacturing",
  "plastics": "manufacturing",
  "paper": "manufacturing",
  "textile": "manufacturing",
  "packaging": "manufacturing",
  "printing": "manufacturing",
  // ── Agriculture ──────────────────────────────────────────────────────────────
  "agriculture": "agriculture",
  "agtech": "agriculture",
  "farming": "agriculture",
  "agribusiness": "agriculture",
  "crop": "agriculture",
};

// Short ambiguous keys require word boundaries to avoid false positives like
// "ai" matching "airlines", or "ml" matching "html".
const WORD_BOUNDARY_KEYS = new Set(["ai", "ml", "it", "llm", "nlp"]);

export function normalizeIndustry(raw: string | null | undefined): IndustryValue | null {
  if (!raw) return null;
  const lower = raw.toLowerCase().trim();
  if (INDUSTRY_MAP[lower]) return INDUSTRY_MAP[lower];
  for (const [key, value] of Object.entries(INDUSTRY_MAP)) {
    const found = WORD_BOUNDARY_KEYS.has(key)
      ? new RegExp(`\\b${key}\\b`).test(lower)
      : lower.includes(key);
    if (found) return value;
  }
  return "other";
}

// ─── Company type normalization ───────────────────────────────────────────────

export type CompanyTypeValue =
  | "startup"
  | "enterprise"
  | "public_company"
  | "agency"
  | "nonprofit"
  | "government"
  | "university"
  | "other";

const COMPANY_TYPE_MAP: Record<string, CompanyTypeValue> = {
  "startup": "startup",
  "start-up": "startup",
  "early stage": "startup",
  "seed stage": "startup",
  "enterprise": "enterprise",
  "large company": "enterprise",
  "corporation": "enterprise",
  "public company": "public_company",
  "publicly traded": "public_company",
  "publicly listed": "public_company",
  "listed company": "public_company",
  "nasdaq": "public_company",
  "nyse": "public_company",
  "ftse": "public_company",
  "partnership": "startup", // Exa uses "Partnership" for OpenAI-type structures
  "agency": "agency",
  "consultancy": "agency",
  "nonprofit": "nonprofit",
  "non-profit": "nonprofit",
  "ngo": "nonprofit",
  "charity": "nonprofit",
  "foundation": "nonprofit",
  "government": "government",
  "public sector": "government",
  "federal": "government",
  "university": "university",
  "college": "university",
  "academic": "university",
  "research institution": "university",
};

export function normalizeCompanyType(raw: string | null | undefined): CompanyTypeValue | null {
  if (!raw) return null;
  const lower = raw.toLowerCase().trim();
  if (COMPANY_TYPE_MAP[lower]) return COMPANY_TYPE_MAP[lower];
  for (const [key, value] of Object.entries(COMPANY_TYPE_MAP)) {
    if (lower.includes(key)) return value;
  }
  return "other";
}

// ─── Employee count normalization ─────────────────────────────────────────────

const EMPLOYEE_RANGES = ["1", "2-10", "11-50", "51-200", "201-500", "501-1000", "1001-5000", "5001-10000", "10000+"] as const;
export type EmployeeCountRange = typeof EMPLOYEE_RANGES[number];

export function normalizeEmployeeCount(raw: string | number | null | undefined): EmployeeCountRange | null {
  if (raw == null) return null;

  const s = String(raw).trim();

  // Canonical range string — fast path
  if ((EMPLOYEE_RANGES as readonly string[]).includes(s)) return s as EmployeeCountRange;

  // Ranges like "5001-10,000" or "5,001-10000 employees" — use the lower bound
  // to avoid the "500110000" corruption caused by stripping all non-digits.
  const rangeMatch = s.match(/^(\d[\d,]*)\s*[-–]\s*[\d,]+/);
  if (rangeMatch) {
    return bucketByCount(parseInt(rangeMatch[1].replace(/,/g, ""), 10));
  }

  // "10000+" or "10,000+"
  if (/10[,]?000\+/.test(s)) return "10000+";

  // Plain number (possibly with commas or "people"/"employees" suffix)
  const n = typeof raw === "number" ? raw : parseInt(s.replace(/[^0-9]/g, ""), 10);
  if (isNaN(n)) return null;
  return bucketByCount(n);
}

function bucketByCount(n: number): EmployeeCountRange {
  if (n <= 1)      return "1";
  if (n <= 10)     return "2-10";
  if (n <= 50)     return "11-50";
  if (n <= 200)    return "51-200";
  if (n <= 500)    return "201-500";
  if (n <= 1000)   return "501-1000";
  if (n <= 5000)   return "1001-5000";
  if (n <= 10000)  return "5001-10000";
  return "10000+";
}

const EXA_SEARCH_URL = "https://api.exa.ai/search";

// ─── Deep profile pass ────────────────────────────────────────────────────────

/** Fields returned by the deep profile pass (pass 1). */
export interface ExaDeepProfileResult {
  website_url:          string | null;
  linkedin_url:         string | null;
  industry:             IndustryValue | null;
  company_type:         CompanyTypeValue | null;
  employee_count_range: EmployeeCountRange | null;
  founded_year:         number | null;
  total_funding_usd:    number | null;
  hq_address:           string | null;
  hq_city:              string | null;
  hq_country:           string | null;
}

// Exactly 10 properties (Exa outputSchema max). Enum-constrained fields mean the
// AI outputs our exact taxonomy values — no regex parsing required.
const DEEP_PROFILE_SCHEMA = {
  type: "object",
  properties: {
    website_url: {
      type: "string",
      description: "Official company website URL, e.g. https://stripe.com. Not LinkedIn, not Crunchbase. Empty string if not found.",
    },
    linkedin_url: {
      type: "string",
      description: "Official LinkedIn company page URL. Must start with https://www.linkedin.com/company/. Example: https://www.linkedin.com/company/stripe. Empty string if not found.",
    },
    industry: {
      type: "string",
      enum: [
        "software","ai_ml","fintech","healthtech","edtech",
        "ecommerce","retail","food_beverage","automotive","construction","hospitality",
        "media","cybersecurity","hardware","aerospace","energy","logistics",
        "real_estate","consulting","government","nonprofit","gaming","legal",
        "manufacturing","agriculture","other",
      ],
      description:
        "Primary industry vertical. Choose the most specific match:\n" +
        "- 'software': SaaS, dev tools, cloud, HR tech, data platforms\n" +
        "- 'ai_ml': AI/ML/LLM/foundation model companies\n" +
        "- 'fintech': banking, payments, insurance, investment\n" +
        "- 'healthtech': hospitals, biotech, pharma, medical devices, mental health\n" +
        "- 'edtech': schools, online learning, tutoring\n" +
        "- 'ecommerce': online-first marketplaces and DTC brands\n" +
        "- 'retail': physical or omnichannel stores (grocery, home improvement, department stores, pharmacy, fashion, sporting goods)\n" +
        "- 'food_beverage': restaurants, fast food, food manufacturing, breweries, coffee\n" +
        "- 'automotive': car makers, dealerships, EV, auto parts\n" +
        "- 'construction': contractors, homebuilders, architecture, civil engineering\n" +
        "- 'hospitality': hotels, travel, tourism, casinos, events\n" +
        "- 'media': news, entertainment, publishing, advertising, sports, music\n" +
        "- 'cybersecurity': security products and services\n" +
        "- 'hardware': semiconductors, electronics, telecom equipment\n" +
        "- 'aerospace': aerospace, defense, aviation, space\n" +
        "- 'energy': oil/gas, utilities, renewables, cleantech\n" +
        "- 'logistics': shipping, trucking, freight, delivery, airlines\n" +
        "- 'real_estate': property, proptech, real estate services\n" +
        "- 'consulting': management consulting, staffing, professional services\n" +
        "- 'government': federal, state, local agencies, military\n" +
        "- 'nonprofit': charities, NGOs, foundations\n" +
        "- 'gaming': video games, esports\n" +
        "- 'legal': law firms, legaltech\n" +
        "- 'manufacturing': industrial manufacturing, chemicals, packaging\n" +
        "- 'agriculture': farming, agtech, agribusiness\n" +
        "- 'other': only if none of the above clearly apply",
    },
    company_type: {
      type: "string",
      enum: ["startup","enterprise","public_company","agency","nonprofit","government","university","other"],
      description:
        "Company type:\n" +
        "- 'startup': early-stage, VC-backed, or growth-stage private company\n" +
        "- 'enterprise': large private company — 1000+ employees but NOT publicly traded\n" +
        "- 'public_company': publicly traded on a stock exchange (NYSE, NASDAQ, LSE, etc.) — Fortune-500, S&P 500, or any listed firm\n" +
        "- 'agency': consulting, marketing, staffing, or services firm\n" +
        "- 'nonprofit': NGOs, charities, foundations\n" +
        "- 'government': federal, state, local, or military agencies\n" +
        "- 'university': colleges, universities, academic institutions\n" +
        "- 'other': only if none of the above fit",
    },
    employee_count_range: {
      type: "string",
      enum: ["1","2-10","11-50","51-200","201-500","501-1000","1001-5000","5001-10000","10000+"],
      description: "Employee headcount range. Choose the best matching range. Return empty string if unknown.",
    },
    founded_year: {
      type: "number",
      description: "Year the company was founded, e.g. 2010. Return 0 if unknown.",
    },
    total_funding_usd: {
      type: "number",
      description: "Sum of all investment round amounts received by the company (Seed, Series A, B, C, etc.) in USD as a plain integer. This is MONEY INVESTED in the company — always much less than the company valuation. Example: a company valued at $10B might have raised only $1B across rounds. Do NOT return valuation, market cap, or stock price. If the company is publicly listed on NYSE/NASDAQ/etc, return 0. Return 0 if unknown.",
    },
    hq_address: {
      type: "string",
      description: "Full headquarters street address — no PO Box. Include street, city, state/province, postal code, country. Example: '510 Townsend St, San Francisco, CA 94103, United States'. Empty string if not found.",
    },
    hq_city: {
      type: "string",
      description: "Headquarters city and state/province if US/CA, otherwise just city. Examples: 'San Francisco, CA' or 'London' or 'Berlin'. Empty string if not found.",
    },
    hq_country: {
      type: "string",
      description: "Headquarters country as ISO 3166-1 alpha-2 code, e.g. 'US', 'GB', 'DE', 'FR'. Empty string if not found.",
    },
  },
};

/**
 * Pass 1 schema entries available for dynamic reuse in Pass 2's free 10th slot.
 * company.ts picks the highest-priority null field and passes its key to
 * fetchExaDeepSocialData, which injects it into the schema at runtime.
 */
export const PASS1_FALLBACK_SCHEMA_DEFS: Record<string, object> = {
  industry:             DEEP_PROFILE_SCHEMA.properties.industry,
  company_type:         DEEP_PROFILE_SCHEMA.properties.company_type,
  hq_city:              DEEP_PROFILE_SCHEMA.properties.hq_city,
  hq_country:           DEEP_PROFILE_SCHEMA.properties.hq_country,
  employee_count_range: DEEP_PROFILE_SCHEMA.properties.employee_count_range,
  founded_year:         DEEP_PROFILE_SCHEMA.properties.founded_year,
  total_funding_usd:    DEEP_PROFILE_SCHEMA.properties.total_funding_usd,
  hq_address:           DEEP_PROFILE_SCHEMA.properties.hq_address,
  linkedin_url:         DEEP_PROFILE_SCHEMA.properties.linkedin_url,
};

/**
 * Deep profile pass — fetches core company facts via Exa type:"deep" + outputSchema.
 * All fields are enum-constrained or format-specified so the AI output maps directly
 * to DB columns without any regex parsing.
 */
export async function fetchExaDeepProfileData(
  companyName: string,
  apiKey: string,
  websiteHint?: string | null
): Promise<ExaDeepProfileResult | null> {
  try {
    const domainClause = websiteHint ? ` (${websiteHint})` : "";
    const query =
      `${companyName}${domainClause} company: official website, LinkedIn, ` +
      `industry, company type, employee count, founded year, total funding raised, ` +
      `headquarters city country and full street address`;

    const body = {
      query,
      type: "deep",
      numResults: 1,
      outputSchema: DEEP_PROFILE_SCHEMA,
    };

    const res = await fetch(EXA_SEARCH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify(body),
      signal: (() => { const c = new AbortController(); setTimeout(() => c.abort(), 60_000); return c.signal; })(),
    });

    if (!res.ok) return null;

    const data = await res.json() as { output?: { content?: Record<string, unknown> } };
    const c = data.output?.content;
    if (!c) return null;

    return {
      website_url:          normalizeUrl(c.website_url as string) ?? null,
      linkedin_url:         normalizeUrl(c.linkedin_url as string) ?? null,
      industry:             normalizeIndustry(c.industry as string),
      company_type:         normalizeCompanyType(c.company_type as string),
      employee_count_range: normalizeEmployeeCount(c.employee_count_range as string),
      founded_year:         c.founded_year ? Number(c.founded_year) || null : null,
      // Cap at $25B — anything above is almost certainly a valuation leak, not rounds raised.
      total_funding_usd:    (() => {
        const v = c.total_funding_usd ? Math.round(Number(c.total_funding_usd)) : 0;
        return v > 0 && v <= 25_000_000_000 ? v : null;
      })(),
      hq_address:           (c.hq_address as string)?.trim() || null,
      hq_city:              (c.hq_city as string)?.trim() || null,
      hq_country:           normalizeCountryCode(c.hq_country as string) ?? ((c.hq_country as string)?.trim() || null),
    };
  } catch {
    return null;
  }
}

// ─── Country / URL helpers ────────────────────────────────────────────────────

// Country name → ISO 3166-1 alpha-2 mapping for the most common values Exa returns.
const COUNTRY_CODE_MAP: Record<string, string> = {
  "united states": "US", "usa": "US", "us": "US",
  "united kingdom": "GB", "uk": "GB",
  "canada": "CA", "germany": "DE", "france": "FR",
  "india": "IN", "china": "CN", "japan": "JP",
  "australia": "AU", "brazil": "BR", "singapore": "SG",
  "netherlands": "NL", "sweden": "SE", "switzerland": "CH",
  "israel": "IL", "south korea": "KR", "spain": "ES",
  "italy": "IT", "denmark": "DK", "finland": "FI",
  "norway": "NO", "ireland": "IE", "poland": "PL",
  "austria": "AT", "belgium": "BE", "new zealand": "NZ",
  "mexico": "MX", "argentina": "AR", "chile": "CL",
  "colombia": "CO", "nigeria": "NG", "south africa": "ZA",
  "uae": "AE", "united arab emirates": "AE",
};

export function normalizeCountryCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const lower = raw.toLowerCase().trim();
  // Already an alpha-2 code
  if (/^[a-z]{2}$/.test(lower)) return lower.toUpperCase();
  return COUNTRY_CODE_MAP[lower] ?? null;
}

/**
 * Exa's company category results return rich structured text in highlights
 * (e.g. "Founded Year: 2010", "Headquarters: San Francisco, United States",
 * "Employees: 9,502 (5001-10,000 employees)", "LinkedIn: linkedin.com/company/stripe").
 * This parser extracts those fields; it's the fallback when summary JSON is absent.
 */
/**
 * Strips narrative noise from a raw country string captured by HQ regexes.
 * Returns null if the whole value is noise (e.g. "with presence in Slovenia").
 *   "Norway with presence in Slovenia" → "Norway"
 *   "with presence in Slovenia"        → null
 *   "United States"                    → "United States"
 */
// ─── URL helper ───────────────────────────────────────────────────────────────

/** Validate that a URL string is a real URL; return null if it's garbage. */
export function normalizeUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.href;
  } catch {
    return null;
  }
}

// ─── Deep social search ───────────────────────────────────────────────────────

/** Fields returned by the deep social pass (pass 2). */
export interface ExaDeepSocialResult {
  // Ordered least → most important
  huggingface_url: string | null; // desired but niche; prioritised below facebook
  facebook_url:    string | null;
  github_url:      string | null;
  glassdoor_url:   string | null;
  crunchbase_url:  string | null;
  youtube_url:     string | null;
  tiktok_url:      string | null;
  instagram_url:   string | null;
  x_url:           string | null;
  /** Set when a Pass 1 null field was injected as the dynamic 10th schema slot. */
  fallback: { key: string; raw: unknown } | null;
}

// 9 fixed social link fields — the 10th slot is filled dynamically per company
// from PASS1_FALLBACK_SCHEMA_DEFS to backfill any null Pass 1 field.
// Ordered least → most important. Every description emphasises COMPANY brand pages
// (not personal accounts) and provides a domain constraint + real example.
const DEEP_SOCIAL_SCHEMA = {
  type: "object",
  properties: {
    // ── Lowest priority ──────────────────────────────────────────────────────
    huggingface_url: {
      type: "string",
      description: "Official Hugging Face ORGANIZATION page for the company (not a personal user profile). Must start with https://huggingface.co/. Example: https://huggingface.co/mistralai. Empty string if not found.",
    },
    facebook_url: {
      type: "string",
      description: "Official Facebook COMPANY PAGE (not an employee or founder's personal profile). Must start with https://www.facebook.com/. Example: https://www.facebook.com/airbnb. Empty string if not found.",
    },
    github_url: {
      type: "string",
      description: "Official GitHub ORGANIZATION for the company's engineering/open-source work (not a personal account or a specific repo). Must start with https://github.com/. Example: https://github.com/stripe. Empty string if not found.",
    },
    glassdoor_url: {
      type: "string",
      description: "Glassdoor employer overview page for the company. Must start with https://www.glassdoor.com/Overview/. Example: https://www.glassdoor.com/Overview/Working-at-Stripe-EI_IE671535.11,17.htm. Empty string if not found.",
    },
    crunchbase_url: {
      type: "string",
      description: "Crunchbase organization profile for the company. Must start with https://www.crunchbase.com/organization/. Example: https://www.crunchbase.com/organization/stripe. Empty string if not found.",
    },
    youtube_url: {
      type: "string",
      description: "Official YouTube CHANNEL where the company posts product demos, marketing, or educational content (not a personal channel). Must start with https://www.youtube.com/. Example: https://www.youtube.com/@stripe. Empty string if not found.",
    },
    tiktok_url: {
      type: "string",
      description: "Official TikTok BRAND ACCOUNT for the company — the corporate marketing channel, NOT a founder or employee's personal account. Many consumer and B2B companies have brand TikTok pages. Must start with https://www.tiktok.com/@. Example: https://www.tiktok.com/@shopify. Empty string if not found.",
    },
    instagram_url: {
      type: "string",
      description: "Official Instagram BRAND ACCOUNT for the company — the corporate marketing page (e.g. @shopify, @hubspot, @lemonade_inc), NOT a founder or employee's personal account. Must start with https://www.instagram.com/. Example: https://www.instagram.com/shopify. Empty string if not found.",
    },
    // ── Highest priority ─────────────────────────────────────────────────────
    x_url: {
      type: "string",
      description: "Official X (Twitter) COMPANY account — the brand/corporate handle, NOT the CEO or founder's personal account. Example: https://x.com/stripe is the company account; do not return a founder's personal handle. Must start with https://x.com/ or https://twitter.com/. Empty string if not found.",
    },
  },
};

/**
 * Deep social pass — fetches all social media links via Exa type:"deep" + outputSchema.
 * Runs once per company (tracked by exa_social_enriched_at), never re-runs automatically.
 *
 * @param fallbackFieldKey - Optional key from PASS1_FALLBACK_SCHEMA_DEFS to inject as
 *   the dynamic 10th schema slot, backfilling a null Pass 1 field in the same call.
 * @param industry - Pass 1 industry value; appended to the query to help Exa
 *   disambiguate common company names (e.g. "Cedar (healthtech)" vs "Cedar (fintech)").
 */
export async function fetchExaDeepSocialData(
  companyName: string,
  apiKey: string,
  websiteHint?: string | null,
  fallbackFieldKey?: string | null,
  industry?: string | null,
): Promise<ExaDeepSocialResult | null> {
  try {
    const domainClause = websiteHint ? ` (${websiteHint})` : "";
    // Industry context disambiguates common names and steers Exa toward the right entity.
    const industryCtx = (industry && industry !== "other") ? `, ${industry}` : "";
    // Emphasise BRAND/CORPORATE pages to prevent Exa returning founder personal accounts.
    const query =
      `${companyName}${domainClause}${industryCtx} official company brand pages and corporate accounts: ` +
      `X/Twitter brand handle, Instagram brand page, TikTok brand channel, ` +
      `GitHub organization, YouTube company channel, Glassdoor employer page, ` +
      `Crunchbase organization, HuggingFace organization, Facebook company page. ` +
      `Return only the official corporate accounts — NOT personal profiles of founders or employees.`;

    // Build schema: 9 fixed social properties + optional 10th Pass 1 fallback
    const properties: Record<string, object> = { ...DEEP_SOCIAL_SCHEMA.properties };
    const usedFallback = fallbackFieldKey && PASS1_FALLBACK_SCHEMA_DEFS[fallbackFieldKey]
      ? fallbackFieldKey
      : null;
    if (usedFallback) {
      properties[usedFallback] = PASS1_FALLBACK_SCHEMA_DEFS[usedFallback];
    }

    const body = {
      query,
      type: "deep",
      numResults: 1,
      outputSchema: { type: "object", properties },
    };

    const res = await fetch(EXA_SEARCH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify(body),
      signal: (() => { const c = new AbortController(); setTimeout(() => c.abort(), 60_000); return c.signal; })(),
    });

    if (!res.ok) return null;

    const data = await res.json() as { output?: { content?: Record<string, unknown> } };
    const content = data.output?.content;
    if (!content) return null;

    return {
      huggingface_url: normalizeUrl(content.huggingface_url as string),
      facebook_url:    normalizeUrl(content.facebook_url as string),
      github_url:      normalizeUrl(content.github_url as string),
      glassdoor_url:   normalizeUrl(content.glassdoor_url as string),
      crunchbase_url:  normalizeUrl(content.crunchbase_url as string),
      youtube_url:     normalizeUrl(content.youtube_url as string),
      tiktok_url:      normalizeUrl(content.tiktok_url as string),
      instagram_url:   normalizeUrl(content.instagram_url as string),
      x_url:           normalizeUrl(content.x_url as string),
      fallback: usedFallback
        ? { key: usedFallback, raw: content[usedFallback] ?? null }
        : null,
    };
  } catch {
    return null;
  }
}

