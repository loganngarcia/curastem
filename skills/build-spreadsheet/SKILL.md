---
name: Build spreadsheet
description: Create spreadsheets, tables, and data trackers. Use when asked about "spreadsheet", "table", "tracker", "budget", "data", or "Excel".
metadata:
  author: curastem
  version: "1.0.0"
---

# Build Spreadsheet

Guide students through creating spreadsheets, tables, and data trackers. Use Curastem's **document editor** for HTML tables with headers and rows—students can copy into Google Sheets or Excel. Use the **mini app builder** for interactive tables with sorting, filtering, or simple calculations.

## Curastem Tools to Use

### 1. Document Editor (update_doc) — Primary Tool
Use to create structured tables with <table>, <thead>, <tbody>, <tr>, <th>, <td>. Add headers, rows, and columns. Format for budgets, trackers, schedules, grade calculators, or lists. Students copy into Google Sheets or Excel for full spreadsheet features. Use <h2> for section labels, multiple tables for different sheets.

### 2. Mini App Builder (create_app) — Interactive Option
Use to build interactive data tools: budget calculator, grade tracker, habit tracker, or simple CRM. Output valid HTML with <style> and <script>. Include input fields, buttons for add/delete, and display of totals or summaries. Follow Curastem guidelines: #141414 background, 48px top margin, Curastem.org label bottom-right, unique IDs on all interactive elements, mobile-responsive.

### 3. Whiteboard (update_whiteboard) — Optional
Use to plan structure: columns needed, formulas, or data flow. Diagram relationships between fields.

## When to Apply

- Student wants to create a spreadsheet or table
- Student asks for a budget, tracker, schedule, or data organizer
- Student needs to organize information in rows and columns
- Student wants to track grades, expenses, or habits

## Workflow

1. **Gather** — Get their data needs: columns, rows, calculations, or use case
2. **Plan** — Optionally use whiteboard to map structure
3. **Build** — Use update_doc for static tables or create_app for interactive
4. **Refine** — Add columns, fix formulas, or adjust layout based on feedback

## Key Guidance

- Clear headers for each column
- For budgets: category, amount, date, notes
- For trackers: consistent row format, easy to add new entries
- Doc tables copy well into Google Sheets; students can add formulas there
- For create_app: use localStorage to persist data if needed
