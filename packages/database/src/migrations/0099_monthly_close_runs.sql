-- =============================================================================
-- 0099: Monthly Close Runs + Run Steps (Wave 28 Phase A Agent PhA2)
-- =============================================================================
-- Persists the per-tenant run-state + step-by-step audit for
-- `MonthlyCloseOrchestrator`. The orchestrator runs on the 1st of every
-- month at 02:00 UTC; each (tenant_id, period_year, period_month) triple
-- is unique so re-runs are idempotent (409 CONFLICT from the trigger
-- endpoint, OR resumed if the existing row is still in progress).
--
-- Mirrors the conventions used by 0091_notification_dispatch_log and
-- 0097_move_out_approvals: JSONB columns for rich run metadata alongside
-- scalar columns for operator filtering. Idempotent — safe to re-run.
-- =============================================================================

-- ---------------------------------------------------------------
-- monthly_close_runs: one row per (tenant_id, period_year, period_month).
-- Tracks the overall orchestrator run — status, totals, timing.
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS monthly_close_runs (
  id                      TEXT          PRIMARY KEY,
  tenant_id               TEXT          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  period_year             INTEGER       NOT NULL,
  period_month            INTEGER       NOT NULL,
  period_start            TIMESTAMPTZ   NOT NULL,
  period_end              TIMESTAMPTZ   NOT NULL,
  status                  TEXT          NOT NULL DEFAULT 'running',
  trigger                 TEXT          NOT NULL DEFAULT 'cron',
  started_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  completed_at            TIMESTAMPTZ   NULL,
  triggered_by            TEXT          NOT NULL DEFAULT 'system',
  reconciled_payments     INTEGER       NOT NULL DEFAULT 0,
  statements_generated    INTEGER       NOT NULL DEFAULT 0,
  kra_mri_total_minor     BIGINT        NOT NULL DEFAULT 0,
  disbursement_total_minor BIGINT       NOT NULL DEFAULT 0,
  currency                TEXT          NULL,
  summary_json            JSONB         NOT NULL DEFAULT '{}'::jsonb,
  last_error              TEXT          NULL,
  created_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CONSTRAINT monthly_close_runs_status_chk CHECK (
    status IN ('running', 'awaiting_approval', 'completed', 'failed', 'skipped')
  ),
  CONSTRAINT monthly_close_runs_period_chk CHECK (
    period_month BETWEEN 1 AND 12 AND period_year BETWEEN 2020 AND 2100
  )
);

-- Idempotency: one active run per (tenant, period). The uniqueness is
-- across the whole table so a re-trigger for the same period either
-- resumes the existing row (if not completed) or returns 409 CONFLICT.
CREATE UNIQUE INDEX IF NOT EXISTS idx_monthly_close_runs_tenant_period
  ON monthly_close_runs (tenant_id, period_year, period_month);

CREATE INDEX IF NOT EXISTS idx_monthly_close_runs_tenant_status
  ON monthly_close_runs (tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_monthly_close_runs_tenant_started
  ON monthly_close_runs (tenant_id, started_at DESC);

-- ---------------------------------------------------------------
-- monthly_close_run_steps: one row per (run_id, step_name).
-- Audit trail for every step the orchestrator executed — decision,
-- actor, result metadata, timing.
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS monthly_close_run_steps (
  id                TEXT          PRIMARY KEY,
  run_id            TEXT          NOT NULL REFERENCES monthly_close_runs(id) ON DELETE CASCADE,
  tenant_id         TEXT          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  step_name         TEXT          NOT NULL,
  step_index        INTEGER       NOT NULL,
  decision          TEXT          NOT NULL,
  actor             TEXT          NOT NULL DEFAULT 'system',
  policy_rule       TEXT          NULL,
  started_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  completed_at      TIMESTAMPTZ   NULL,
  duration_ms       INTEGER       NULL,
  result_json       JSONB         NOT NULL DEFAULT '{}'::jsonb,
  error_message     TEXT          NULL,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CONSTRAINT monthly_close_run_steps_decision_chk CHECK (
    decision IN ('executed', 'auto_approved', 'awaiting_approval', 'approved', 'skipped', 'failed')
  )
);

-- Idempotency for re-entry: one executed record per (run, step_name).
-- The orchestrator checks for the existing record before re-running a
-- step, so resumes after crash or awaiting_approval are safe.
CREATE UNIQUE INDEX IF NOT EXISTS idx_monthly_close_run_steps_run_step
  ON monthly_close_run_steps (run_id, step_name);

CREATE INDEX IF NOT EXISTS idx_monthly_close_run_steps_tenant_run
  ON monthly_close_run_steps (tenant_id, run_id);

CREATE INDEX IF NOT EXISTS idx_monthly_close_run_steps_run_index
  ON monthly_close_run_steps (run_id, step_index);

COMMENT ON TABLE monthly_close_runs IS
  'One row per (tenant, period). Tracks monthly-close orchestrator lifecycle — Wave 28 PhA2.';
COMMENT ON TABLE monthly_close_run_steps IS
  'Audit trail of every step the orchestrator executed — Wave 28 PhA2.';
