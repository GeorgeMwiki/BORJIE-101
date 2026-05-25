-- ─────────────────────────────────────────────────────────────────────
-- Migration 0136 — Agency run checkpoints (durable execution layer).
--
-- Central Command Phase A gap #7 closure (see
-- `.planning/research/central-command/2025-bn-internal-gap-audit.md`):
--   the existing `agency/executor/executor.ts` walks step-by-step and
--   bails on the first failure. A process crash mid-tool leaves goals
--   in `running` with no recovery hint. This table is the durable
--   substrate that lets a separate `durable-runner.ts` wrap the executor
--   with retry + checkpointing + crash-recovery semantics.
--
-- Each step's lifecycle (`pending` → `running` → `success` | `failure`
-- | `paused`) writes one row keyed on (run_id, step_index). The
-- durable runner:
--
--   1. INSERTs a `pending` row before invoking the step's tool.
--   2. UPDATEs to `running` immediately before invocation.
--   3. UPDATEs to `success` (with `output_payload`) on completion, or
--      `failure` (with `error_message`) on exception.
--   4. On transient failure, retries up to N times (default 3) with
--      exponential backoff; each retry bumps `attempt_count`.
--   5. After N failed attempts, UPDATEs to `paused` so an operator can
--      resume the goal manually.
--   6. A recovery worker scans for `state = 'running'` rows whose
--      `started_at` is older than the staleness window (default 5min)
--      and resumes the run from the last `success` checkpoint.
--
-- This is the Inngest AgentKit pattern without the dependency — we own
-- the durability layer in-tree so the kernel package keeps zero runtime
-- imports of a third-party orchestrator. Phase B may promote to a real
-- Inngest dashboard once the operator surface needs it.
--
-- Idempotent: CREATE ... IF NOT EXISTS guards everywhere. Safe to re-
-- run. The UNIQUE constraint on (run_id, step_index) ensures step
-- writes are idempotent across retries — UPDATE always finds the same
-- row.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS agency_run_checkpoints (
  id                  TEXT PRIMARY KEY,
  tenant_id           TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  run_id              TEXT NOT NULL,
  goal_id             TEXT NOT NULL,
  step_index          INTEGER NOT NULL,
  step_name           TEXT NOT NULL,
  state               TEXT NOT NULL,
  attempt_count       INTEGER NOT NULL DEFAULT 0,
  input_payload       JSONB NOT NULL DEFAULT '{}'::jsonb,
  output_payload      JSONB,
  error_message       TEXT,
  started_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at        TIMESTAMPTZ,
  CONSTRAINT uq_agency_run_checkpoints_run_step UNIQUE (run_id, step_index)
);

-- Recovery scan index — "find every checkpoint stuck in `running` for
-- more than 5min". Partial-style ordering by started_at means a small
-- recovery sweep stays cheap as the table grows.
CREATE INDEX IF NOT EXISTS idx_agency_checkpoints_state
  ON agency_run_checkpoints (state, started_at);

-- Per-tenant per-run traversal — the durable runner resumes a run by
-- listing every checkpoint for (tenant_id, run_id) ordered by
-- step_index ASC and replaying from the last `success`.
CREATE INDEX IF NOT EXISTS idx_agency_checkpoints_tenant_run
  ON agency_run_checkpoints (tenant_id, run_id, step_index);

COMMENT ON TABLE agency_run_checkpoints IS
  'Durable execution checkpoints for the agency executor. One row per (run_id, step_index). State machine: pending → running → success|failure|paused. Powers retry + crash-recovery + operator-resumable goals. Phase A in-tree implementation of the Inngest AgentKit pattern; Phase B may promote to a real Inngest dashboard.';
COMMENT ON COLUMN agency_run_checkpoints.state IS
  'One of: pending | running | success | failure | paused. paused = retries exhausted, operator must resume.';
COMMENT ON COLUMN agency_run_checkpoints.attempt_count IS
  'Bumped on every retry. Bounded by the durable runner''s max-attempts (default 3).';
COMMENT ON COLUMN agency_run_checkpoints.started_at IS
  'When the FIRST attempt began. Recovery worker uses (state=''running'' AND started_at < NOW() - staleness_window) to detect crashed runs.';
