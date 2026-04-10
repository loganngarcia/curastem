<a name="top"></a>

<p align="center">
  <a href="https://curastem.org">
    <img width="196" height="196" alt="Curastem org" src="https://github.com/user-attachments/assets/48317dcc-0b09-41b7-9b3a-41d4ec6ddcf1" />
  </a>
</p>

<p align="center">
  <a href="https://curastem.org">
    <img src="https://img.shields.io/badge/Website-curastem.org-0B87DA?style=for-the-badge&labelColor=2C2C2E&color=0B87DA" alt="Website" />
  </a>
  <a href="https://linkedin.com/company/curastem">
    <img src="https://img.shields.io/badge/Follow%20on%20LinkedIn-Curastem-0077B5?style=for-the-badge&logo=linkedin&logoColor=white&color=0077B5" alt="Follow on LinkedIn" />
  </a>
  <a href="https://github.com/loganngarcia/curastem/blob/main/LICENSE">
    <img src="https://img.shields.io/badge/license-AGPL--3.0-D97757?style=for-the-badge&labelColor=2C2C2E&color=D97757" alt="License: AGPL-3.0" />
  </a>
</p>

# 🩵 Curastem — open jobs data
<img width="3096" height="1080" alt="Open-source jobs map" src="https://github.com/user-attachments/assets/0e0cbe9f-5458-4151-8eb4-5d75c0d6afb7" />


‎ 
[**Curastem.org**](https://curastem.org) is a 501(c)(3) nonprofit building **public-interest job data** at scale. The core of the product is a growing corpus of **500,000+ job postings** updated hourly. We are working toward becoming the **Wikipedia for jobs** (open and community-aligned job information) and are **actively seeking funding** to accelerate that mission.

Alongside jobs, [**Curastem.org**](https://curastem.org) delivers **live mentorship** (including real-time video) and **AI assistance** across resumes, applications, scholarships, and career questions. AI is woven through both the jobs pipeline and the mentor experience.

[![GitHub stars](https://img.shields.io/github/stars/loganngarcia/curastem?style=social)](https://github.com/loganngarcia/curastem) ⬅️ *Support this non-profit with a star! ⭐️*

---

## Why this matters

Job information is fragmented behind proprietary search UIs and short-lived postings. Students and workers need **trustworthy, durable, and reusable** job data, not only another job board. Curastem combines **open data infrastructure** with **human mentorship** so guidance and opportunity can scale together.

---

## Highlights

- **Jobs at the center** — Hundreds of thousands of postings in D1, with ongoing ingest and enrichment (including AI where it helps).
- **Public API and MCP** — REST at `api.curastem.org` plus an MCP server for agents.
- **MCP on the main site** — Job search and context are first-class on Curastem.org.
- **Live mentorship** — Real-time video and chat between students and mentors.
- **AI throughout** — Mentor-side assistance (e.g. Gemini Live), skills menu, and jobs enrichment.
- **Open source** — AGPL-3.0 so the community can inspect, improve, and reuse the stack.

---

## Join the community

Contributions welcome across **new job sources and fetchers**, ingest, API design, MCP tools, Framer components, and docs.

- **Found a bug?** Open an issue.
- **Have an idea?** Start a discussion.
- **Want to contribute?** Check open issues and open a PR.

Curastem is a 501(c)(3) nonprofit. What we ship is meant for learners and workers who need fair access to opportunity and guidance.

---

## What’s in this monorepo

| Package | Role |
| --- | --- |
| `curastem-jobs-api/` | Cloudflare Worker — ingests jobs, stores them in Cloudflare D1, REST API at [api.curastem.org](https://api.curastem.org) |
| `curastem-jobs-mcp/` | [Model Context Protocol](https://modelcontextprotocol.io) server over the jobs API (search, job details, similar roles, market views) |
| `agent-skills-api/` | Cloudflare Worker — skill catalog for slash commands in `web.tsx` ([skills.curastem.org](https://skills.curastem.org)) |
| `blog-writer-ui/` | Internal Next.js app for blog authoring (publishes to Framer CMS) |
| `web.tsx` | Framer code component — AI chat, Gemini Live, mentorship UI |
| `skills/` | `SKILL.md` files consumed by `agent-skills-api` |

The **jobs MCP is integrated on [curastem.org](https://curastem.org)** so the live site can reason over the same job corpus developers get via the API and MCP tools.

---

## Get started — grow the jobs database

The highest-impact contributions are **new public job sources** that are not already in Curastem. More boards mean better coverage for anyone using the API or MCP.

### Add a source for an existing ATS type

Many employers publish open roles on **Greenhouse, Lever, Ashby, Workday, SmartRecruiters**, and [other supported boards](curastem-jobs-api/README.md#supported-ats-types). For those, ingestion is driven by rows in the `sources` table. See **[Adding a new source](curastem-jobs-api/README.md#adding-a-new-source)** in `curastem-jobs-api/README.md` (SQL example and how the hourly cron picks up new rows).

### Add support for a new ATS or custom careers site

If the careers feed is not covered yet, implement a new fetcher and register it. Follow **[Adding a new ATS type](curastem-jobs-api/README.md#adding-a-new-ats-type)** and the deeper walkthrough in [`curastem-jobs-api/CONTRIBUTING.md`](curastem-jobs-api/CONTRIBUTING.md) (types, `src/ingestion/sources/`, `registry.ts`, seeds or DB inserts). Read [`curastem-jobs-api/ARCHITECTURE.md`](curastem-jobs-api/ARCHITECTURE.md) first so changes stay aligned with ingestion and deduplication.

### Run the jobs API locally

Install and Wrangler setup live under **[Local development](curastem-jobs-api/README.md#local-development)** in `curastem-jobs-api/README.md`. The MCP server in `curastem-jobs-mcp/` consumes the same API for tools used on [curastem.org](https://curastem.org).

### Optional — embed the Framer mentorship UI

To experiment with **`web.tsx`** outside curastem.org, add a [Gemini API key](https://aistudio.google.com/apikey), copy `web.tsx` into a Framer project, and configure the property panel (API key, prompt, accent, suggestions). That path does not change the shared jobs corpus; source work still lives under `curastem-jobs-api/`.

---

## License

[AGPL-3.0](LICENSE). If you modify this software and run it as a service, share your source so job data and mentorship stay open for everyone.

---

**Built by [Curastem](https://curastem.org).** Open data for jobs, real humans for mentorship, AI where it helps.

<a href="#top" style="position: fixed; bottom: 20px; right: 20px; background: #0B87DA; color: white; padding: 10px 15px; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 600; z-index: 1000; box-shadow: 0 2px 8px rgba(0,0,0,0.2);">↑ Back to top</a>
