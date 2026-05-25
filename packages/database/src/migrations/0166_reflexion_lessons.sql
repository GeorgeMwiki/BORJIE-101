-- ============================================================================
-- Migration 0166 — Reflexion lessons (LessonStore persistent backing).
--
-- Persistent backing for the `LessonStore` port declared in
-- `packages/ai-copilot/src/reflexion/types.ts`. Lessons are per-
-- (tenant_id, task_tag) bucketed Reflexion teaching material; the
-- renderer reads up to N lessons by recency_score DESC.
--
-- Idempotent: CREATE TABLE / INDEX ... IF NOT EXISTS.
-- Backwards-compatible: no destructive ALTERs.
-- ============================================================================

CREATE TABLE IF NOT EXISTS reflexion_lessons (
  id              TEXT PRIMARY KEY,
  tenant_id       TEXT NOT NULL,
  task_tag        TEXT NOT NULL,
  lesson          TEXT NOT NULL,
  evidence        TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  recency_score   DOUBLE PRECISION NOT NULL DEFAULT 0,
  inserted_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_reflexion_lessons_tenant_tag_lesson
  ON reflexion_lessons (tenant_id, task_tag, lesson);

CREATE INDEX IF NOT EXISTS idx_reflexion_lessons_bucket_recency
  ON reflexion_lessons (tenant_id, task_tag, recency_score);

COMMENT ON TABLE reflexion_lessons IS
  'Per-(tenant, task_tag) bucketed Reflexion teaching material; render order = recency_score DESC.';
COMMENT ON COLUMN reflexion_lessons.recency_score IS
  '[0, 1] LRU score; bumped by +0.1 (capped) on duplicate-text insert.';
