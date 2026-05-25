-- =============================================================================
-- 0098: Vacancy-to-Lease Pipeline Runs (Wave 27 Phase A agent PhA1)
-- =============================================================================
-- Persists `VacancyToLeaseOrchestrator` runs — one row per lifecycle from
-- `idle` through `lease_active` (or one of the branch terminals rejected /
-- withdrew / expired / cancelled). The `history_json` column is the audit
-- trail: an append-only list of `VacancyPipelineEvent` envelopes, one per
-- state transition.
--
-- Shape mirrors the TypeScript `VacancyPipelineRunRow` in
-- `packages/ai-copilot/src/orchestrators/vacancy-to-lease/types.ts`. The
-- scalar columns are queryable mirrors of the JSON blob so operators
-- and analytics can filter without unpacking JSON.
--
-- Idempotent: every statement uses IF NOT EXISTS. Safe to re-run.
-- =============================================================================

CREATE TABLE IF NOT EXISTS vacancy_pipeline_runs (
  run_id                    TEXT        PRIMARY KEY,
  tenant_id                 TEXT        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  unit_id                   TEXT        NOT NULL,
  state                     TEXT        NOT NULL,
  listing_id                TEXT        NULL,
  applicant_customer_id     TEXT        NULL,
  negotiation_id            TEXT        NULL,
  lease_id                  TEXT        NULL,
  credit_rating_score       INTEGER     NULL,
  history_json              JSONB       NOT NULL DEFAULT '[]'::jsonb,
  started_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at                  TIMESTAMPTZ NULL,
  cancelled_reason          TEXT        NULL,
  approval_reason           TEXT        NULL
);

-- Tenant-scoped lookups (list runs for a tenant, count open pipelines).
CREATE INDEX IF NOT EXISTS idx_vacancy_pipeline_runs_tenant
  ON vacancy_pipeline_runs (tenant_id);

-- Most common query: all runs for a given unit (history + current state).
CREATE INDEX IF NOT EXISTS idx_vacancy_pipeline_runs_tenant_unit
  ON vacancy_pipeline_runs (tenant_id, unit_id);

-- Dashboard filter: "show me all open pipelines in state=X".
CREATE INDEX IF NOT EXISTS idx_vacancy_pipeline_runs_tenant_state
  ON vacancy_pipeline_runs (tenant_id, state);

-- Single-active-pipeline-per-unit guard. Multiple *terminal* runs per
-- unit are fine (history); only one non-terminal run may exist at a
-- time. Enforced via a partial unique index on (tenant_id, unit_id)
-- filtered to non-terminal states.
CREATE UNIQUE INDEX IF NOT EXISTS uq_vacancy_pipeline_runs_one_open_per_unit
  ON vacancy_pipeline_runs (tenant_id, unit_id)
  WHERE state NOT IN ('lease_active', 'rejected', 'withdrew', 'expired', 'cancelled');

-- End of 0098
