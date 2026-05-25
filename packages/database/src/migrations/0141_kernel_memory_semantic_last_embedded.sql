-- ─────────────────────────────────────────────────────────────────────
-- Migration 0141 — kernel_memory_semantic.last_embedded_at column.
--
-- B4 / Central Command Phase B — Progressive Intelligence.
--
-- Adds a resume-marker column for the bulk re-embedder (stage 07).
-- The consolidation worker iterates `kernel_memory_semantic` in
-- chunks of 500 rows, re-embeds with the current OpenAI model, and
-- stamps `last_embedded_at = NOW()` so a crash + restart resumes
-- where the previous run left off.
--
-- Resumability rule: rows whose `last_embedded_at` is newer than the
-- model-version cutoff (passed at runtime by the worker) are skipped.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS.
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE kernel_memory_semantic
  ADD COLUMN IF NOT EXISTS last_embedded_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_kernel_mem_semantic_last_embedded
  ON kernel_memory_semantic (tenant_id, last_embedded_at NULLS FIRST);

COMMENT ON COLUMN kernel_memory_semantic.last_embedded_at IS
  'Timestamp of last successful re-embedding. NULL = never re-embedded (highest priority). Used by consolidation-worker stage 07 to skip rows newer than the embedding-model cutoff.';
