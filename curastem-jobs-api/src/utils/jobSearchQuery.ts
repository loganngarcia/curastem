/**
 * Minimal normalization for the `q` search parameter (trim, collapse whitespace).
 *
 * Query interpretation — expanding "swe", mapping "big tech" to roles or employers,
 * multi-step search strategies — belongs in the **tool-calling model** (Gemini) and
 * in **tool declarations** (MCP `search_jobs`, Framer `search_jobs` parameters),
 * not in this API. Per Gemini function-calling flow, the model fills `query` / `keywords`
 * / `company` from user intent; the worker executes retrieval with those arguments.
 *
 * Direct HTTP clients without an LLM should send explicit terms in `q` (and filters).
 */
export function normalizeJobSearchQuery(q: string): string {
  return q.trim().replace(/\s+/g, " ");
}

/** Same slug rules as company rows — used for exact employer match alongside title search. */
export function companySlugFromSearchQuery(q: string): string {
  return normalizeJobSearchQuery(q)
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

/**
 * Every "significant" token in q must appear in the job title. Stops vector and
 * legacy SQL noise where employer names contained words like "Product" (e.g. CPSC).
 */
export function jobTitleMatchesSearchTokens(title: string, q: string): boolean {
  const qn = normalizeJobSearchQuery(q).toLowerCase();
  if (!qn) return true;
  const tokens = qn.split(/\s+/).filter((t) => t.length >= 2);
  if (tokens.length === 0) {
    if (qn.length <= 1) return true;
    return title.toLowerCase().includes(qn);
  }
  const tl = title.toLowerCase();
  return tokens.every((t) => tl.includes(t));
}

const TITLE_SQL_MAX_TOKENS = 8;

/** Max distinct employers in GET /jobs?company=a,b,c — OR on c.slug */
const MAX_COMPANY_SLUGS_IN_FILTER = 24;

/**
 * Split `company` into slug tokens (comma-separated in the query string).
 * Same param supports one slug or many — multi matches any listed employer.
 */
export function companySlugsFromFilterParam(company: string | undefined): string[] {
  if (!company?.trim()) return [];
  return [
    ...new Set(
      company
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter((s) => s.length > 0)
    ),
  ].slice(0, MAX_COMPANY_SLUGS_IN_FILTER);
}

/**
 * Tokens for `title` SQL filters — each must appear in `j.title` (AND of LIKEs).
 * Keeps list/near-SQL aligned with {@link jobTitleMatchesSearchTokens} (vector gate).
 */
export function titleSearchTokensForSql(title: string): string[] {
  const n = normalizeJobSearchQuery(title).toLowerCase();
  if (!n) return [];
  const tokens = n.split(/\s+/).filter((t) => t.length >= 2);
  if (tokens.length > 0) {
    return tokens.slice(0, TITLE_SQL_MAX_TOKENS);
  }
  if (n.length >= 2) {
    return [n];
  }
  return [];
}
