-- Migration 002: add embedding_generated_at to jobs table
-- Run: wrangler d1 execute curastem-jobs --remote --file=migrations/002_add_embedding_column.sql
--
-- This column tracks whether a job's vector embedding is current in the
-- Vectorize index. NULL means not yet embedded. Cleared when description_raw
-- changes so the embedding gets regenerated on the next ingestion run.

ALTER TABLE jobs ADD COLUMN embedding_generated_at INTEGER;
