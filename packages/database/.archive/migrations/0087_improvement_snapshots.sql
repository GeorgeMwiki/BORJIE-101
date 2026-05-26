-- =============================================================================
-- 0087: Improvement Snapshots (Organizational Awareness)
-- =============================================================================
-- Per-tenant, per-period metric snapshots. Enables "how has our arrears ratio
-- changed since we adopted the platform?" queries by diffing against the
-- earliest snapshot. One row per (tenant_id, period_start, metric).
-- =============================================================================

CREATE TABLE IF NOT EXISTS improvement_snapshots (
  id              TEXT PRIMARY KEY,
  tenant_id       TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  metric          TEXT NOT NULL CHECK (metric IN (
                    'occupancy_rate',
                    'arrears_ratio',
                    'avg_days_to_collect',
                    'avg_maintenance_resolution_hours',
                    'renewal_rate',
                    'avg_vacancy_duration_days',
                    'compliance_breach_count',
                    'avg_lease_drafting_hours',
                    'operator_hours_saved_estimate'
                  )),
  period_kind     TEXT NOT NULL CHECK (period_kind IN ('weekly','monthly')),
  period_start    TIMESTAMPTZ NOT NULL,
  period_end      TIMESTAMPTZ NOT NULL,
  value           DOUBLE PRECISION NOT NULL,
  sample_size     INTEGER NOT NULL DEFAULT 0,
  confidence_low  DOUBLE PRECISION,
  confidence_high DOUBLE PRECISION,
  is_baseline     BOOLEAN NOT NULL DEFAULT FALSE,
  evidence        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_improvement_snapshots
  ON improvement_snapshots(tenant_id, metric, period_kind, period_start);

CREATE INDEX IF NOT EXISTS idx_improvement_snapshots_tenant_metric
  ON improvement_snapshots(tenant_id, metric, period_start DESC);

CREATE INDEX IF NOT EXISTS idx_improvement_snapshots_baseline
  ON improvement_snapshots(tenant_id, metric, is_baseline)
  WHERE is_baseline = TRUE;
