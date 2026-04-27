/**
 * Some job boards embed "JSON-LD" with trailing commas in nested objects, which
 * `JSON.parse` rejects. Strip common issues before giving up.
 */
export function parseJsonLenientUnknown(raw: string): unknown | null {
  let s = raw.trim();
  for (let i = 0; i < 5; i++) {
    try {
      return JSON.parse(s) as unknown;
    } catch {
      const next = s.replace(/,(\s*[}\]])/g, "$1");
      if (next === s) return null;
      s = next;
    }
  }
  return null;
}

export function parseJsonLenientObject(raw: string): Record<string, unknown> | null {
  const v = parseJsonLenientUnknown(raw);
  if (v && typeof v === "object" && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  return null;
}
