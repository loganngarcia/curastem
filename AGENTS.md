# AGENTS.md — Curastem Monorepo

High-level context for AI agents. Use this for orientation and principles; discover specifics by reading the codebase.

---

## Monorepo Overview

| Project | Purpose |
| --- | --- |
| `curastem-jobs-api/` | Cloudflare Worker — ingests jobs from ATS sources, stores in D1, exposes REST API at api.curastem.org |
| `curastem-jobs-mcp/` | MCP server over the jobs API — tools for search, job details, similar jobs, market overview |
| `app/agent-skills-api/` | Cloudflare Worker — serves skill catalog from GitHub for the slash-command menu in `app/web.tsx` (`skills.curastem.org`) |
| `blog-writer-ui/` | Next.js app (Vercel) — internal blog authoring, publishes to Framer CMS |
| `app/web.tsx` | Framer code component — AI mentorship chat (Vertex/Gemini Live) |
| `skills/` | SKILL.md files consumed by `app/agent-skills-api` |

---

## General Principles

**Open-source**
- What's most important is open-source maintainability. This is a large-scale open-source project that thousands of developers need to understand clearly and rely on to be stable and rapidly ship new features for production-ready workflows. 

**Jobs API**
- Use Cloudflare MCP for any Cloudflare interactions and operations, when available
- Always deploy any Cloudflare changes without asking
- When adding or verifying a company or source, **always report two numbers in chat**: (1) how many **jobs** the ingest path returns (list size or API `total`), and (2) how many of those have a **substantive description at ingest time** (`description_raw` non-null after the fetcher runs — not “pending AI enrichment”). If the source only returns titles or one-line snippets until enrichment, say so explicitly.
- **D1 schema changes** — one PR should update `curastem-jobs-api/schema.sql`, matching `*Row` types in `src/shared/types.ts`, and any `ensure*Columns` / `ensureJobIndexes` guards in `src/shared/db/queries.ts` so cold databases and docs stay aligned.
- Job URLs should point directly to the posting page, not a search or filtered list.
- Locations should be normalized to a consistent format (e.g., "City, ST" for US, "City, Country" for international, or "Remote").
- Avoid redundant API calls — skip enrichment when data is already populated.
- Company logos: keep small (e.g., 64px max)
- AI lazy loading enrichment: Gemini for summary, structured description, location, salary, etc
- Regex enrichment: salary, location, experience level, etc when available

**Framer components** (`app/web.tsx`, `donorform.tsx`, etc.)
- Must follow Framer code component conventions: layout annotations, root element with `props.style`, property controls + defaultProps.
- Allowed imports: `react`, `react-dom`, `framer`, `framer-motion` only.
- Never access `window`/`document`/`navigator` during render — use `useEffect` or guards.
- For heavy animations, use `useIsStaticRenderer()` so canvas and export stay safe.
- See Framer docs for details; the codebase shows the patterns in use.

**Blog content**
- Avoid em dashes, colons, and semicolons in prose.
- Include 2–3 inline images when they fit the content.
- Match the style of existing published articles.

---

## Learned Preferences

- When discussing any company’s ingestion, include **job count** and **description coverage** (how many roles get real text at fetch time vs thin or null). Same when validating a new source in chat.
- Always respond in English. This rule overrides any other rules.
- Code comments: concise, senior-engineer style — explain the **why**, not the what. No timestamps or obvious restatements.
- Markdown: use markdown tables, not ASCII tables.
- When multiple valid approaches exist, present options and let the user choose before implementing.
- Prefer `gemini-3.1-flash-lite-preview` for AI features (cost and speed).
- Verify implementations work before marking tasks complete.
- Store secrets via `wrangler secret put`; never hardcode.
- Do not commit unless the user asks.
