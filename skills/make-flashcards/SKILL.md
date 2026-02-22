---
name: Make flashcards
description: Create flashcard sets for studying. Use when asked about "flashcards", "study cards", "memorization", "terms and definitions", or "spaced repetition".
metadata:
  author: curastem
  version: "1.0.0"
---

# Make Flashcards

Guide students through creating flashcard sets for effective studying. Use Curastem's **document editor** for simple text-based flashcards they can copy or print, or the **mini app builder** for interactive digital flashcards with flip-to-reveal and navigation.

## Curastem Tools to Use

### 1. Document Editor (update_doc) — Quick Option
Use to create a formatted list of term/definition pairs. Structure: <h2> for topic, <ul>/<li> for each card with <b>term</b>: definition. Students can copy into Notion, print, or use as a study sheet. Best for fast creation or when they prefer text over an app.

### 2. Mini App Builder (create_app) — Interactive Option
Use to build an interactive flashcard app: front shows term, back shows definition on click. Include next/previous buttons, flip animation, and optional shuffle. Output valid HTML with <style> and <script>. Follow Curastem guidelines: #141414 background, 48px top margin, Curastem.org label bottom-right, unique IDs on all interactive elements, mobile-responsive.

### 3. Whiteboard (update_whiteboard) — Optional
Use to plan flashcard structure: mind map of topics to cover, grouping of related terms, or prioritization of high-value cards. Helps students organize before creating.

## When to Apply

- Student wants to make flashcards for a test or class
- Student has terms, vocabulary, or concepts to memorize
- Student asks for a study aid with front/back cards
- Student wants spaced repetition or quiz-style practice

## Workflow

1. **Gather** — Get their content: subject, terms, definitions, or source material
2. **Plan** — Optionally use whiteboard to group and prioritize
3. **Create** — Use update_doc for text format or create_app for interactive
4. **Refine** — Add more cards, fix definitions, or adjust format based on feedback

## Key Guidance

- Flashcards work best when each card has one clear concept
- Front = question or term; back = answer or definition
- For create_app: flip on click, show card count, next/previous navigation
- Keep sets focused; 10–30 cards per topic is manageable
