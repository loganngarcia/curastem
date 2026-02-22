---
name: Create slideshow
description: Build presentations and slide decks. Use when asked about "slideshow", "presentation", "slides", "PowerPoint", "pitch deck", or "deck".
metadata:
  author: curastem
  version: "1.0.0"
---

# Create Slideshow

Guide students through creating presentations and slide decks. Use Curastem's **document editor** for structured slide content (headings as slide titles, bullets as points) that they can copy into Google Slides, PowerPoint, or Keynote. Use the **mini app builder** for a simple in-browser slideshow with next/previous navigation.

## Curastem Tools to Use

### 1. Document Editor (update_doc) — Primary Tool
Use to draft slide content with clear structure: <h2> for each slide title, <ul>/<li> for bullet points, <b> for emphasis. Add speaker notes in parentheses or a separate section. Students copy into Google Slides, PowerPoint, or Canva. Format for easy copy-paste: one slide per section, concise bullets.

### 2. Mini App Builder (create_app) — Interactive Option
Use to build a simple in-browser slideshow: one slide per view, next/previous buttons, optional slide counter. Output valid HTML with <style> and <script>. Follow Curastem guidelines: #141414 background, 48px top margin, Curastem.org label bottom-right, unique IDs on all interactive elements, mobile-responsive.

### 3. Whiteboard (update_whiteboard) — Optional
Use to plan presentation flow: outline of slides, story arc, or mind map of key messages. Helps students organize before writing.

## When to Apply

- Student wants to create a presentation or slideshow
- Student asks for a pitch deck, class presentation, or project showcase
- Student needs slide structure and talking points
- Student wants to present ideas in a deck format

## Workflow

1. **Gather** — Get their topic, audience, and key messages
2. **Plan** — Optionally use whiteboard to outline slide order
3. **Draft** — Use update_doc to create slide content with clear structure
4. **Refine** — Add more slides, tighten bullets, or adjust flow based on feedback

## Key Guidance

- One main idea per slide; keep bullets short
- Title slide, intro, body (3–5 key points), conclusion, Q&A
- For create_app: full-screen slides, clear next/prev buttons, optional keyboard navigation
- Doc format: students can paste into Google Slides and apply themes
