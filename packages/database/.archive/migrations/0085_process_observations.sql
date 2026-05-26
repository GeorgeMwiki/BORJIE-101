-- =============================================================================
-- 0085: Process Observations (Organizational Awareness)
-- =============================================================================
-- Append-only time-series of process-stage events emitted by the platform
-- event bus. Used by the process-miner to build per-tenant statistical models
-- (avg/p50/p95/p99, variants, re-open rates).
--
-- Multi-tenant strict: every row is scoped by tenant_id. BRIN index on
-- observed_at because inserts are monotonic time-series.
-- =============================================================================

CREATE TABLE IF NOT EXISTS process_observations (
  id              TEXT PRIMARY KEY,
  tenant_id       TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  process_kind    TEXT NOT NULL CHECK (process_kind IN (
                    'maintenance_case',
                    'lease_renewal',
                    'arrears_case',
                    'payment_reconcile',
                    'approval_decision',
                    'tender_bid',
                    'inspection',
                    'letter_generation',
                    'training_completion'
                  )),
  process_instance_id TEXT NOT NULL,
  stage           TEXT NOT NULL,
  previous_stage  TEXT,
  actor_kind      TEXT NOT NULL CHECK (actor_kind IN (
                    'human','system','ai','vendor','tenant'
                  )),
  actor_id        TEXT,
  variant         TEXT NOT NULL DEFAULT 'standard',
  is_reopen       BOOLEAN NOT NULL DEFAULT FALSE,
  is_stuck        BOOLEAN NOT NULL DEFAULT FALSE,
  duration_ms_from_previous BIGINT,
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  observed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_process_obs_tenant_kind_stage
  ON process_observations(tenant_id, process_kind, stage);

CREATE INDEX IF NOT EXISTS idx_process_obs_instance
  ON process_observations(tenant_id, process_kind, process_instance_id);

-- BRIN on observed_at — append-only monotonic time-series. Keeps writes cheap.
CREATE INDEX IF NOT EXISTS idx_process_obs_observed_at_brin
  ON process_observations USING BRIN (observed_at);
