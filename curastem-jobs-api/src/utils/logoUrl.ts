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

/** True when the URL is a placeholder or a Brandfetch wordmark we should upgrade to a Logo.dev icon. */
export function isLowTrustLogoUrl(url: string | null | undefined): boolean {
  if (!url) return true;
  if (url.startsWith(GOOGLE_FAVICON)) return true;
  // Old Logo.dev URLs without format=png — replace with the new format.
  if (url.startsWith(`${IMG_LOGO_DEV}/`) && !url.includes("format=png")) return true;
  // Brandfetch wordmark path pattern — replace with Logo.dev square icon when possible.
  // Icon paths use /w/{n}/h/{n}/icon.* or /symbol.*; wordmarks use /theme/.*/logo.*
  if (url.includes("cdn.brandfetch.io") && /\/theme\/[^/]+\/logo\.[a-z]+/.test(url)) return true;
  return false;
}

export function googleFaviconUrl(domain: string): string {
  return `${GOOGLE_FAVICON}?domain=${encodeURIComponent(domain)}&sz=${LOGO_MAX_PX}`;
}

function logoDevDisplayUrl(domain: string, token: string): string {
  const q = new URLSearchParams({
    token,
    size: String(LOGO_MAX_PX),
    format: "png",   // PNG renders the icon/symbol variant; avoids horizontal SVG wordmarks
  });
  return `${IMG_LOGO_DEV}/${encodeURIComponent(domain)}?${q}`;
}

/** HEAD probe: 404 when no brand asset and fallback=404 (so we can use Google favicon). */
function logoDevProbeUrl(domain: string, token: string): string {
  const q = new URLSearchParams({
    token,
    size: String(LOGO_MAX_PX),
    format: "png",
    fallback: "404",
  });
  return `${IMG_LOGO_DEV}/${encodeURIComponent(domain)}?${q}`;
}

function withLogoParams(logoUrl: string): string {
  try {
    const u = new URL(logoUrl);
    u.searchParams.set("size", String(LOGO_MAX_PX));
    // Ensure format=png is present so isLowTrustLogoUrl treats this as a high-quality asset.
    if (u.hostname === "img.logo.dev" || u.hostname.endsWith(".logo.dev")) {
      u.searchParams.set("format", "png");
    }
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
  return withLogoParams(hit.logo_url);
}

/**
 * Search Logo.dev by company name when no domain is available.
 * Only works with secret keys (`sk_`). Takes the top result — no domain validation,
 * so only call this for well-known companies where the first hit is reliable.
 * Returns null when no result or the token is not a secret key.
 */
export async function resolveLogoUrlByName(name: string, logoDevToken?: string): Promise<string | null> {
  if (!logoDevToken?.startsWith("sk_")) return null;
  try {
    const res = await fetch(`${API_LOGO_DEV}/search?q=${encodeURIComponent(name)}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${logoDevToken}` },
    });
    if (!res.ok) return null;
    const hits = (await res.json()) as LogoDevSearchHit[];
    if (!Array.isArray(hits) || hits.length === 0) return null;
    const hit = hits[0];
    if (!hit?.logo_url) return null;
    return withLogoParams(hit.logo_url);
  } catch {
    return null;
  }
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
