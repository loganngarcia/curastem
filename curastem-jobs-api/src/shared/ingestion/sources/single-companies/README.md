# Single-company sources

This folder (`single-companies/`) holds fetchers for **one employer’s** public careers surface (custom RPC, WordPress JSON, Algolia hub, etc.). Their `source_type` values are short company-style names (`uber`, `meta`, `jobright`, …), distinct from reusable ATS modules in the parent `sources/` folder.

When adding a new one-off parser, prefer a new file named after the company, register it in `registry.ts`, and add the `SourceType` in `types.ts`.
