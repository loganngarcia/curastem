/**
 * Company logo URLs for enrichment — Logo.dev with Google favicon fallback.
 *
 * - Publishable keys (`pk_`): use `img.logo.dev` directly (HEAD probe with fallback=404).
 * - Secret keys (`sk_`): `img.logo.dev` rejects `sk_` (401). Logo.dev Search API accepts
 *   `Bearer sk_` and returns `logo_url` with an embedded publishable token.
 *
 * Docs: https://www.logo.dev/docs/logo-images/introduction
 */

export const LOGO_MAX_PX = 64;

const IMG_LOGO_DEV = "https://img.logo.dev";
const API_LOGO_DEV = "https://api.logo.dev";
const GOOGLE_FAVICON = "https://www.google.com/s2/favicons";

interface LogoDevSearchHit {
  domain?: string;
  logo_url?: string;
}

/** True when the URL is a cheap CDN placeholder we may replace with a better logo later. */
export function isLowTrustLogoUrl(url: string | null | undefined): boolean {
  if (!url) return true;
  return url.startsWith(GOOGLE_FAVICON) || url.startsWith(`${IMG_LOGO_DEV}/`);
}

export function googleFaviconUrl(domain: string): string {
  return `${GOOGLE_FAVICON}?domain=${encodeURIComponent(domain)}&sz=${LOGO_MAX_PX}`;
}

function logoDevDisplayUrl(domain: string, token: string): string {
  const q = new URLSearchParams({
    token,
    size: String(LOGO_MAX_PX),
  });
  return `${IMG_LOGO_DEV}/${encodeURIComponent(domain)}?${q}`;
}

/** HEAD probe: 404 when no brand asset and fallback=404 (so we can use Google favicon). */
function logoDevProbeUrl(domain: string, token: string): string {
  const q = new URLSearchParams({
    token,
    size: String(LOGO_MAX_PX),
    fallback: "404",
  });
  return `${IMG_LOGO_DEV}/${encodeURIComponent(domain)}?${q}`;
}

function withLogoSize(logoUrl: string): string {
  try {
    const u = new URL(logoUrl);
    u.searchParams.set("size", String(LOGO_MAX_PX));
    return u.toString();
  } catch {
    return logoUrl;
  }
}

/**
 * Secret key: Logo.dev Search returns img URLs with an embedded publishable token.
 * Only use a row whose domain exactly matches (avoids wrong-brand matches).
 */
async function resolveLogoUrlWithSecretKey(domain: string, secretKey: string): Promise<string | null> {
  const res = await fetch(`${API_LOGO_DEV}/search?q=${encodeURIComponent(domain)}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${secretKey}` },
  });
  if (!res.ok) return null;
  const hits = (await res.json()) as LogoDevSearchHit[];
  if (!Array.isArray(hits) || hits.length === 0) return null;
  const lower = domain.toLowerCase();
  const hit = hits.find((h) => h.domain?.toLowerCase() === lower);
  if (!hit?.logo_url) return null;
  return withLogoSize(hit.logo_url);
}

/** Publishable key: probe img CDN; fall back to Google favicon when no asset. */
async function resolveLogoUrlWithPublishableKey(domain: string, token: string): Promise<string> {
  const google = googleFaviconUrl(domain);
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8_000);
    const res = await fetch(logoDevProbeUrl(domain, token), {
      method: "HEAD",
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (res.ok) return logoDevDisplayUrl(domain, token);
  } catch {
    // Network or timeout — fall back
  }
  return google;
}

/**
 * Prefer Logo.dev when a token is set and the API/CDN has a logo; otherwise Google favicon.
 */
export async function resolveLogoUrl(domain: string, logoDevToken?: string): Promise<string> {
  const google = googleFaviconUrl(domain);
  if (!logoDevToken) return google;

  if (logoDevToken.startsWith("sk_")) {
    const fromSearch = await resolveLogoUrlWithSecretKey(domain, logoDevToken);
    return fromSearch ?? google;
  }

  // Publishable (`pk_`) or legacy token treated as img CDN token
  return resolveLogoUrlWithPublishableKey(domain, logoDevToken);
}
