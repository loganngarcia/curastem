/**
 * Detect ATS teasers that carry almost no job substance before any AI call.
 * Conservative: returns null when uncertain so Gemini can decide on lazy load.
 */

import { htmlToText } from "./normalize.ts";

/** Normalized phrases that indicate a apply-only teaser, not a real description. */
const TEASER_PATTERNS: RegExp[] = [
  /\bapply\s+to\s+learn\s+more\b/i,
  /\bapply\s+now\s+to\s+learn\s+more\b/i,
  /\bclick\s+apply\b.*\blearn\s+more\b/is,
  /\bvisit\s+.*\s+to\s+apply\b/i,
  /\bno\s+description\s+(available|provided)\b/i,
  /\bdescription\s+will\s+be\s+available\b/i,
  /\bplease\s+apply\s+for\s+details\b/i,
  /\bapply\s+for\s+more\s+information\b/i,
];

const MAX_PLACEHOLDER_CHARS = 280;

/**
 * Returns 'placeholder' only for obvious teaser-only text; null if we should defer to AI.
 */
export function heuristicListingQuality(descriptionRaw: string | null | undefined): "placeholder" | null {
  if (descriptionRaw == null || !descriptionRaw.trim()) return "placeholder";
  const text = htmlToText(descriptionRaw).replace(/\s+/g, " ").trim();
  if (text.length === 0) return "placeholder";
  if (text.length <= MAX_PLACEHOLDER_CHARS) {
    for (const re of TEASER_PATTERNS) {
      if (re.test(text)) return "placeholder";
    }
    // Very short + almost no sentence structure beyond a CTA
    if (text.length < 120 && /\bapply\b/i.test(text) && !/[.!?].+[.!?]/.test(text)) {
      return "placeholder";
    }
  }
  return null;
}
