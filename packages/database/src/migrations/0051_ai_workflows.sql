-- =============================================================================
-- 0051: AI workflow engine — Wave-11
-- =============================================================================
-- Stores workflow runs (executions) and per-step logs. Workflows themselves
-- are defined in code (packages/ai-copilot/src/workflows/workflow-registry.ts)
-- so the DB only holds run state, not workflow definitions.
-- =============================================================================

CREATE TABLE IF NOT EXISTS ai_workflow_runs (
  id                 TEXT PRIMARY KEY,
  tenant_id          TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  workflow_id        TEXT NOT NULL,
  workflow_version   TEXT NOT NULL,
  initiated_by       TEXT NOT NULL,
  idempotency_key    TEXT,
  status             TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'awaiting_approval', 'completed', 'failed', 'cancelled')),
  input              JSONB NOT NULL DEFAULT '{}'::jsonb,
  output             JSONB NOT NULL DEFAULT '{}'::jsonb,
  current_step       TEXT,
  error_message      TEXT,
  started_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at       TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_workflow_runs_tenant_status
  ON ai_workflow_runs(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_ai_workflow_runs_workflow
  ON ai_workflow_runs(tenant_id, workflow_id);
CREATE UNIQUE INDEX IF NOT EXISTS uidx_ai_workflow_runs_idem
  ON ai_workflow_runs(tenant_id, workflow_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS ai_workflow_step_logs (
  id                 TEXT PRIMARY KEY,
  run_id             TEXT NOT NULL REFERENCES ai_workflow_runs(id) ON DELETE CASCADE,
  tenant_id          TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  step_id            TEXT NOT NULL,
  step_index         INTEGER NOT NULL,
  status             TEXT NOT NULL
    CHECK (status IN ('pending', 'running', 'completed', 'failed', 'skipped', 'awaiting_approval')),
  input              JSONB NOT NULL DEFAULT '{}'::jsonb,
  output             JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message      TEXT,
  duration_ms        INTEGER,
  approved_by        TEXT,
  approved_at        TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_workflow_step_logs_run
  ON ai_workflow_step_logs(run_id, step_index);
CREATE INDEX IF NOT EXISTS idx_ai_workflow_step_logs_tenant
  ON ai_workflow_step_logs(tenant_id);
