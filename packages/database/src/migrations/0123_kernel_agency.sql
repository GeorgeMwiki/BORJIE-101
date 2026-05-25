-- ─────────────────────────────────────────────────────────────────────
-- Migration 0123 — Kernel agency layer.
--
-- Two tables that together back the brain's "acts in full control"
-- kernel slice:
--
--   kernel_goals         — persistent objectives the brain tracks
--                          across days, with a JSON `steps` array for
--                          the decomposition.
--   kernel_action_audit  — append-only every-transition log the
--                          executor writes (running → done|failed|
--                          awaiting-approval|skipped|unknown-tool).
--
-- Idempotent: CREATE TABLE / INDEX ... IF NOT EXISTS guards. Safe to
-- re-run on an existing schema.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS kernel_goals (
  id              TEXT PRIMARY KEY,
  tenant_id       TEXT NOT NULL,
  user_id         TEXT NOT NULL,
  thread_id       TEXT NOT NULL,
  title           TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL,
  priority        TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ,
  steps           JSONB NOT NULL DEFAULT '[]'::jsonb,
  steps_total     INTEGER NOT NULL DEFAULT 0,
  steps_done      INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_kernel_goals_tenant_user_status
  ON kernel_goals (tenant_id, user_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_kernel_goals_thread
  ON kernel_goals (thread_id);

COMMENT ON TABLE kernel_goals IS
  'Per-(tenant, user) persistent objective stack the brain works on across days. The `steps` JSON column carries the executor''s plan decomposition; stepsTotal/stepsDone mirror the JSON for cheap dashboard queries.';

CREATE TABLE IF NOT EXISTS kernel_action_audit (
  id              TEXT PRIMARY KEY,
  tenant_id       TEXT NOT NULL,
  user_id         TEXT NOT NULL,
  goal_id         TEXT NOT NULL,
  step_id         TEXT NOT NULL,
  tool_name       TEXT,
  decision        TEXT NOT NULL,
  payload_hash    TEXT NOT NULL,
  outcome         TEXT,
  error_message   TEXT,
  started_at      TIMESTAMPTZ,
  ended_at        TIMESTAMPTZ,
  latency_ms      DOUBLE PRECISION,
  captured_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kernel_action_audit_tenant_time
  ON kernel_action_audit (tenant_id, captured_at DESC);

CREATE INDEX IF NOT EXISTS idx_kernel_action_audit_goal
  ON kernel_action_audit (goal_id);

CREATE INDEX IF NOT EXISTS idx_kernel_action_audit_step
  ON kernel_action_audit (step_id);

COMMENT ON TABLE kernel_action_audit IS
  'Append-only audit of every executor step transition (running, done, failed, awaiting-approval, skipped, unknown-tool). Powers replay + drift dashboards.';
