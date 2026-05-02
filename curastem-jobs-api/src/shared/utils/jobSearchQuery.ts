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
 *
 * **Comma-separated roles** — Up to {@link MAX_JOB_SEARCH_PHRASES} phrases separated by
 * commas (e.g. `Product Manager, Software Engineer`) match jobs whose title satisfies
 * **any** phrase (see {@link jobTitleMatchesCommaSeparatedQuery}). Prefix a token with
 * `-` to exclude titles containing it (e.g. `Software Engineer, -Senior`).
 */
export const MAX_JOB_SEARCH_PHRASES = 5;

export function normalizeJobSearchQuery(q: string): string {
  return q.trim().replace(/\s+/g, " ");
}

export interface ParsedJobSearchQuery {
  includePhrases: string[];
  excludeTokens: string[];
}

const TITLE_SQL_MAX_TOKENS = 8;

function uniqCapped(values: string[], max: number): string[] {
  return [...new Set(values)].slice(0, max);
}

/**
 * Parse comma-separated role phrases plus global negative tokens.
 *
 * Examples:
 * - `Product Manager, Software Engineer` → include either phrase.
 * - `Product Manager, Software Engineer, -Senior` → include either phrase, exclude Senior.
 * - `Software Engineer -Senior` → include Software Engineer, exclude Senior.
 */
export function parseJobSearchQuery(q: string): ParsedJobSearchQuery {
  const n = normalizeJobSearchQuery(q);
  if (!n) return { includePhrases: [], excludeTokens: [] };

  const includePhrases: string[] = [];
  const excludeTokens: string[] = [];

  for (const part of n.split(",")) {
    const includeWords: string[] = [];
    for (const rawWord of part.trim().split(/\s+/)) {
      const word = rawWord.trim();
      if (!word) continue;
      if (word.startsWith("-") && word.length > 1) {
        const token = normalizeSearchToken(word.slice(1));
        if (token.length >= 2) excludeTokens.push(token);
      } else {
        includeWords.push(word);
      }
    }
    const phrase = normalizeJobSearchQuery(includeWords.join(" "));
    if (phrase) includePhrases.push(phrase);
  }

  return {
    includePhrases: uniqCapped(includePhrases, MAX_JOB_SEARCH_PHRASES),
    excludeTokens: uniqCapped(excludeTokens, TITLE_SQL_MAX_TOKENS),
  };
}

/** Comma-separated positive role phrases for `q` — deduped, capped, trimmed. */
export function jobSearchPhrasesFromQ(q: string): string[] {
  return parseJobSearchQuery(q).includePhrases;
}

/** Negative title tokens from `q` / `title`, capped for SQL bind safety. */
export function excludedTitleSearchTokensFromQ(q: string): string[] {
  return parseJobSearchQuery(q).excludeTokens;
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
function normalizeSearchToken(t: string): string {
  return t.replace(/^[,;:.'"()]+|[,;:.'"()]+$/g, "").toLowerCase();
}

export function jobTitleMatchesSearchTokens(title: string, q: string): boolean {
  const parsed = parseJobSearchQuery(q);
  const qn = normalizeJobSearchQuery(parsed.includePhrases.join(" ")).toLowerCase();
  const tl = title.toLowerCase();
  if (parsed.excludeTokens.some((t) => tl.includes(t))) return false;
  if (!qn) return true;
  const tokens = qn.split(/\s+/).map(normalizeSearchToken).filter((t) => t.length >= 2);
  if (tokens.length === 0) {
    if (qn.length <= 1) return true;
    return tl.includes(qn);
  }
  return tokens.every((t) => tl.includes(t));
}

/** True if the job title matches every token in any single comma-separated phrase of `q`. */
export function jobTitleMatchesCommaSeparatedQuery(title: string, q: string): boolean {
  const parsed = parseJobSearchQuery(q);
  const tl = title.toLowerCase();
  if (parsed.excludeTokens.some((t) => tl.includes(t))) return false;
  const phrases = parsed.includePhrases;
  if (phrases.length === 0) return true;
  if (phrases.length === 1) return jobTitleMatchesSearchTokens(title, phrases[0]);
  return phrases.some((p) => jobTitleMatchesSearchTokens(title, p));
}

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
  const tokens = n
    .split(/\s+/)
    .map(normalizeSearchToken)
    .filter((t) => t.length >= 2);
  if (tokens.length > 0) {
    return tokens.slice(0, TITLE_SQL_MAX_TOKENS);
  }
  if (n.length >= 2) {
    return [n];
  }
  return [];
}

/**
 * `AND` clause + LIKE patterns for GET /jobs/map title filter. Comma-separated `q`
 * becomes OR of `j.title LIKE` (aligned with GET /jobs multi-phrase SQL).
 */
export function mapSqlJobTitleLikeFromQ(q: string | undefined): {
  sql: string;
  patterns: string[];
} | null {
  const parsed = parseJobSearchQuery(q ?? "");
  const phrases = parsed.includePhrases;
  const clauses: string[] = [];
  const patterns: string[] = [];

  if (phrases.length === 1) {
    clauses.push("j.title LIKE ?");
    patterns.push(`%${phrases[0]}%`);
  } else if (phrases.length > 1) {
    clauses.push(`(${phrases.map(() => "j.title LIKE ?").join(" OR ")})`);
    patterns.push(...phrases.map((p) => `%${p}%`));
  }
  for (const token of parsed.excludeTokens) {
    clauses.push("j.title NOT LIKE ?");
    patterns.push(`%${token}%`);
  }
  if (clauses.length === 0) return null;
  return { sql: `AND ${clauses.join(" AND ")}`, patterns };
}
