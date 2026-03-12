# AGENTS.md — Curastem Monorepo

High-level context for AI agents. Use this for orientation and principles; discover specifics by reading the codebase.

---

## Monorepo Overview

| Project | Purpose |
| --- | --- |
| `curastem-jobs-api/` | Cloudflare Worker — ingests jobs from ATS sources, stores in D1, exposes REST API at api.curastem.org |
| `curastem-jobs-mcp/` | MCP server over the jobs API — tools for search, job details, similar jobs, market overview |
| `agent-skills-api/` | Cloudflare Worker — serves skill catalog from GitHub for the slash-command menu in web.tsx |
| `blog-writer-ui/` | Next.js app (Vercel) — internal blog authoring, publishes to Framer CMS |
| `web.tsx` | Framer code component — AI mentorship chat (Vertex/Gemini Live) |
| `skills/` | SKILL.md files consumed by agent-skills-api |

---

## General Principles

**Open-source**
- What's most important is open-source maintainability. This is a large-scale open-source project that thousands of developers need to understand clearly and rely on to be stable and rapidly ship new features for production-ready workflows. 

**Jobs API**
- Use Cloudflare MCP for any Cloudflare operations, when available
- Some ATS create empty company listings; before adding any company, make sure it returns job listings. 
- Job URLs should point directly to the posting page, not a search or filtered list.
- Locations should be normalized to a consistent format (e.g., "City, ST" or "Remote").
- Avoid redundant API calls — skip enrichment when data is already populated.
- Company logos: keep small (e.g., 64px max); prefer SVG when available.
- AI enrichment (summary, structured description, salary) uses Gemini; salary only when explicitly found in the text.

**Framer components** (`web.tsx`, `donorform.tsx`, etc.)
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

- Always respond in English. This rule overrides any other rules.
- Code comments: concise, senior-engineer style — explain the **why**, not the what. No timestamps or obvious restatements.
- Markdown: use markdown tables, not ASCII tables.
- When multiple valid approaches exist, present options and let the user choose before implementing.
- Prefer `gemini-3.1-flash-lite-preview` for AI features (cost and speed).
- Verify implementations work before marking tasks complete.
- Store secrets via `wrangler secret put`; never hardcode.
- Do not commit unless the user asks.
