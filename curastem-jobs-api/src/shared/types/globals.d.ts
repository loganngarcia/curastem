/**
 * Supplemental global type declarations for APIs that are available in
 * Cloudflare Workers at runtime but not yet included in @cloudflare/workers-types.
 *
 * DOMParser is a W3C standard supported natively in Cloudflare Workers
 * since late 2022, but the community types package lags behind.
 *
 * We declare only the subset we actually use (XML parsing for Personio)
 * rather than pulling in the full DOM lib, which would conflict with
 * the Workers-specific types for fetch, Response, Request, etc.
 */

/** Minimal element interface for XML documents returned by DOMParser. */
interface XmlElement {
  textContent: string | null;
  getElementsByTagName(tagName: string): XmlElementCollection;
  querySelector(selector: string): XmlElement | null;
}

/** Array-like, iterable collection of XmlElement nodes. */
interface XmlElementCollection extends Iterable<XmlElement> {
  readonly length: number;
  [index: number]: XmlElement;
}

/** Minimal XML document interface returned by DOMParser.parseFromString. */
interface XmlDocument extends XmlElement {
  querySelector(selector: string): XmlElement | null;
  querySelectorAll(selector: string): Iterable<XmlElement>;
}

/** DOMParser global available in Cloudflare Workers for HTML/XML parsing. */
declare class DOMParser {
  parseFromString(input: string, type: "text/xml" | "application/xml" | "text/html" | "application/xhtml+xml"): XmlDocument;
}
