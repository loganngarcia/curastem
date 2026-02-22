---
name: Make a study app
description: Help students build interactive study tools using Curastem's mini app builder. Use when asked about "study app", "flashcards", "quiz", "study tool", "practice quiz", or "make an app to study".
metadata:
  author: curastem
  version: "1.0.0"
---

# Make a Study App

Help students create interactive study tools using Curastem's **mini app builder** (create_app). The mini app generates a single HTML file with embedded CSS and JavaScript—perfect for flashcards, quizzes, practice problems, and other study aids. Curastem also has a **document editor** for study guides and a **whiteboard** for concept maps.

## Curastem Tools to Use

### 1. Mini App Builder (create_app) — Primary Tool
Use to build interactive study apps: flashcards (flip to reveal), multiple-choice quizzes (score at end), fill-in-the-blank, matching games, or spaced-repetition style drills. Output valid HTML with <style> and <script>. Must follow Curastem guidelines: #141414 background, 48px top margin, Curastem.org label bottom-right, unique IDs on all interactive elements, mobile-responsive, neobrutalist or modern 28px rounded corners.

### 2. Document Editor (update_doc)
Use to draft study content before building the app: list of terms and definitions, quiz questions and answers, or outline of concepts. Students can provide this; you format and then turn it into an app.

### 3. Whiteboard (update_whiteboard)
Use to plan app structure: flowchart of quiz flow, mind map of topics to include, diagram of flashcard categories. Helps organize before coding.

## When to Apply

- Student wants to build a study app, flashcards, or quiz
- Student asks for an interactive way to practice material
- Student has content (terms, questions) and wants it in app form
- Student wants a custom tool for exam prep

## Workflow

1. **Gather** — Get their study content: terms, questions, topics
2. **Plan** — Optionally use whiteboard to map app structure
3. **Build** — Use create_app to generate the interactive study app
4. **Iterate** — Add more cards, change format, or fix based on feedback

## Key Guidance

- Flashcards: front/back, flip on click, next/previous navigation
- Quizzes: show question, choices, feedback, score at end
- Ensure all buttons and inputs have unique IDs for interactivity
- Keep it simple and focused; one app per study session or topic works well
