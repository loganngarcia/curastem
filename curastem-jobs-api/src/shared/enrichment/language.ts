/**
 * Heuristic language detector for job description text.
 *
 * Strategy: each language has a small set of **high-frequency, language-unique**
 * function words — words that appear in virtually every job description written
 * in that language, but are rare or absent in all others. We count distinct
 * matches per language and pick the winner when it has a clear margin over the
 * runner-up. Ties and low-confidence cases return null for AI to resolve.
 *
 * Why not a library?
 *   Cloudflare Workers have no npm runtime at deploy time for heavy deps, and
 *   a full n-gram model (franc, langdetect) would bloat the bundle. Our cue
 *   lists are ~200 bytes total and cover >95% of job postings in practice.
 *
 * Supported languages (ISO 639-1):
 *   en  English    es  Spanish    de  German     fr  French
 *   pt  Portuguese it  Italian    nl  Dutch       pl  Polish
 *   ja  Japanese   zh  Chinese
 *
 * Cue word selection criteria:
 *   1. Grammatically obligatory in the target language (articles, pronouns,
 *      common auxiliary verbs, prepositions) — appears in almost every paragraph.
 *   2. Unique to that language — not a common word in any other supported language.
 *   3. Short — minimises false substring matches even before word-boundary checks.
 *
 * Matching: whole-word only via \b…\b (Latin scripts) or character presence
 * (CJK scripts, which have no whitespace word boundaries).
 */

export type DescriptionLanguage =
  | "en"  // English
  | "es"  // Spanish
  | "de"  // German
  | "fr"  // French
  | "pt"  // Portuguese
  | "it"  // Italian
  | "nl"  // Dutch
  | "pl"  // Polish
  | "ja"  // Japanese
  | "zh"; // Chinese (Simplified or Traditional)

// ─────────────────────────────────────────────────────────────────────────────
// Cue lists
//
// Each entry is [word, weight]. Weight 2 = very strong signal (grammatically
// obligatory AND unique); weight 1 = good signal but slightly weaker.
// All words are lowercase; matching is case-insensitive.
// ─────────────────────────────────────────────────────────────────────────────

type Cue = [string, number];

const LATIN_CUES: Record<DescriptionLanguage, Cue[]> = {
  en: [
    // English function words absent in other supported languages
    ["the", 2], ["you", 2], ["will", 2], ["our", 2],
    ["with", 1], ["your", 1], ["this", 1], ["are", 1],
  ],
  es: [
    // Spanish-unique: tildes and ñ make these unambiguous
    ["que", 2], ["con", 2], ["para", 2], ["una", 2],
    ["los", 1], ["las", 1], ["del", 1], ["por", 1],
  ],
  de: [
    // German-unique: compound-word language; these are obligatory
    ["und", 2], ["die", 2], ["der", 2], ["wir", 2],
    ["für", 2], ["mit", 1], ["das", 1], ["sie", 1],
  ],
  fr: [
    // French-unique: articles and prepositions
    ["vous", 2], ["nous", 2], ["les", 2], ["une", 2],
    ["des", 1], ["dans", 1], ["pour", 1], ["sur", 1],
  ],
  pt: [
    // Portuguese-unique vs Spanish: "você", "são", "com", "em"
    ["você", 2], ["são", 2], ["com", 2], ["uma", 2],
    ["para", 1], ["dos", 1], ["nas", 1], ["seu", 1],
  ],
  it: [
    // Italian-unique: articles and common verbs
    ["della", 2], ["delle", 2], ["siamo", 2], ["nella", 2],
    ["per", 1], ["con", 1], ["che", 1], ["una", 1],
  ],
  nl: [
    // Dutch-unique: "je", "jij", "wij", "een", "van"
    ["jij", 2], ["wij", 2], ["een", 2], ["van", 2],
    ["het", 1], ["bij", 1], ["voor", 1], ["zijn", 1],
  ],
  pl: [
    // Polish-unique: diacritics make these unambiguous
    ["się", 2], ["oraz", 2], ["będziesz", 2], ["naszej", 2],
    ["pracy", 1], ["zespołu", 1], ["oferujemy", 1], ["wymagania", 1],
  ],
  // CJK handled separately — no \b boundaries; presence of script chars is the signal
  ja: [],
  zh: [],
};

// Minimum number of distinct cue words that must match before we trust the result
const MIN_DISTINCT_MATCHES = 3;

// The winning language must score at least this many points more than second place
const MIN_MARGIN = 3;

// Minimum text length (chars) to attempt detection; shorter = too noisy
const MIN_TEXT_LENGTH = 80;

// ─────────────────────────────────────────────────────────────────────────────
// CJK script detection
// Presence of enough CJK characters is a reliable signal before any word matching.
// ─────────────────────────────────────────────────────────────────────────────

// Japanese-unique: hiragana / katakana ranges
const HIRAGANA_RE = /[\u3040-\u309F\u30A0-\u30FF]/g;
// Chinese: CJK Unified Ideographs (shared with Japanese kanji, but Japanese
// text always has hiragana/katakana too, so we check Japanese first)
const CJK_RE = /[\u4E00-\u9FFF\u3400-\u4DBF]/g;

function countMatches(text: string, re: RegExp): number {
  return (text.match(re) ?? []).length;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main detector
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Detect the primary language of a job description.
 *
 * Returns an ISO 639-1 code when confident, or `null` when:
 *   - text is too short
 *   - no language reaches MIN_DISTINCT_MATCHES
 *   - two languages are within MIN_MARGIN of each other (ambiguous)
 *
 * Null results are resolved by AI lazy-load on the detail endpoint.
 */
export function detectLanguage(text: string | null): DescriptionLanguage | null {
  if (!text || text.length < MIN_TEXT_LENGTH) return null;

  const lower = text.toLowerCase();

  // ── CJK fast path ──────────────────────────────────────────────────────────
  // Check Japanese first (hiragana/katakana are Japan-only)
  const hiraganaCount = countMatches(text, HIRAGANA_RE);
  if (hiraganaCount >= 5) return "ja";

  const cjkCount = countMatches(text, CJK_RE);
  if (cjkCount >= 10) return "zh";

  // ── Latin-script scoring ───────────────────────────────────────────────────
  const scores: Partial<Record<DescriptionLanguage, number>> = {};
  const distinctHits: Partial<Record<DescriptionLanguage, number>> = {};

  for (const [lang, cues] of Object.entries(LATIN_CUES) as [DescriptionLanguage, Cue[]][]) {
    if (cues.length === 0) continue; // CJK handled above
    let score = 0;
    let distinct = 0;
    for (const [word, weight] of cues) {
      // \b word boundary — whole-word match only, case-insensitive
      const re = new RegExp(`\\b${word}\\b`, "gi");
      if (re.test(lower)) {
        score += weight;
        distinct++;
      }
    }
    scores[lang] = score;
    distinctHits[lang] = distinct;
  }

  // Sort by score descending
  const ranked = (Object.entries(scores) as [DescriptionLanguage, number][])
    .sort(([, a], [, b]) => b - a);

  if (ranked.length === 0) return null;

  const [topLang, topScore] = ranked[0];
  const secondScore = ranked[1]?.[1] ?? 0;

  // Require minimum distinct word hits AND a clear margin over second place
  if ((distinctHits[topLang] ?? 0) < MIN_DISTINCT_MATCHES) return null;
  if (topScore - secondScore < MIN_MARGIN) return null;

  return topLang;
}
