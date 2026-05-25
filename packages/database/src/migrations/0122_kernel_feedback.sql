-- ─────────────────────────────────────────────────────────────────────
-- Migration 0122 — Kernel feedback (online-learning signal store).
--
-- Captures every thumbs / explicit-correction signal the user provides
-- on a kernel turn, so the next turn can read it back at step 4
-- (memory recall) and adjust. Mirrors LITFIN's feedback loop and
-- closes the "stock LLMs are STATIC" assessment gap — without an
-- explicit feedback channel the same hallucination repeats forever.
--
-- Idempotent: CREATE TABLE / INDEX ... IF NOT EXISTS guards.
-- Safe to re-run on an existing schema.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS kernel_feedback (
  id               TEXT PRIMARY KEY,
  tenant_id        TEXT NOT NULL,
  user_id          TEXT NOT NULL,
  thought_id       TEXT NOT NULL,
  thread_id        TEXT NOT NULL,
  signal           TEXT NOT NULL,
  rating           INTEGER,
  correction_text  TEXT,
  category         TEXT,
  captured_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kernel_feedback_tenant_user
  ON kernel_feedback (tenant_id, user_id, captured_at DESC);

CREATE INDEX IF NOT EXISTS idx_kernel_feedback_thought
  ON kernel_feedback (thought_id);

CREATE INDEX IF NOT EXISTS idx_kernel_feedback_signal
  ON kernel_feedback (tenant_id, signal);

COMMENT ON TABLE kernel_feedback IS
  'Per-(tenant, user) feedback signal stream. Each row references the upstream provenance.thoughtId of the rated kernel turn. The kernel reads its own per-user rollup at step 4 (memory recall) and biases the next turn toward conservative, citation-heavy output when the recent negative-rate is elevated.';
