-- =============================================================================
-- 0088: Property-grading system — Mr. Mwikila's A–F report card.
-- =============================================================================
-- Two tables:
--   - property_grade_snapshots  — persisted output of scoreProperty(). One row
--                                 per (tenant, property, computedAt). Append-
--                                 only; history enables trajectory charts.
--   - tenant_grading_weights    — per-tenant configurable weights overriding
--                                 DEFAULT_GRADING_WEIGHTS. Missing row = use
--                                 defaults. One row per tenant.
--
-- Aligned with RICS Asset Performance Standards 2024 six-dimension taxonomy
-- (financial, physical, legal/compliance, occupant, sustainability,
-- operational) collapsed to six scoring dimensions. See
-- `packages/ai-copilot/src/property-grading/scoring-model.ts` for math.
-- =============================================================================

CREATE TABLE IF NOT EXISTS property_grade_snapshots (
  id              TEXT PRIMARY KEY,
  tenant_id       TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  property_id     TEXT NOT NULL,
  grade           TEXT NOT NULL
                  CHECK (grade IN (
                    'A_PLUS','A','A_MINUS',
                    'B_PLUS','B','B_MINUS',
                    'C_PLUS','C','C_MINUS',
                    'D_PLUS','D','F',
                    'INSUFFICIENT_DATA'
                  )),
  score           DOUBLE PRECISION NOT NULL,
  dimensions      JSONB NOT NULL DEFAULT '{}'::jsonb,
  reasons         JSONB NOT NULL DEFAULT '[]'::jsonb,
  inputs          JSONB NOT NULL DEFAULT '{}'::jsonb,
  weights         JSONB NOT NULL DEFAULT '{}'::jsonb,
  computed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_property_grade_snapshots_tenant_property
  ON property_grade_snapshots(tenant_id, property_id, computed_at DESC);

CREATE INDEX IF NOT EXISTS idx_property_grade_snapshots_latest
  ON property_grade_snapshots(tenant_id, computed_at DESC);

-- BRIN suits append-heavy snapshots once history grows.
CREATE INDEX IF NOT EXISTS brin_property_grade_snapshots_computed_at
  ON property_grade_snapshots USING BRIN(computed_at);

CREATE TABLE IF NOT EXISTS tenant_grading_weights (
  tenant_id              TEXT PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  income_weight          DOUBLE PRECISION NOT NULL DEFAULT 0.25,
  expense_weight         DOUBLE PRECISION NOT NULL DEFAULT 0.20,
  maintenance_weight     DOUBLE PRECISION NOT NULL DEFAULT 0.20,
  occupancy_weight       DOUBLE PRECISION NOT NULL DEFAULT 0.15,
  compliance_weight      DOUBLE PRECISION NOT NULL DEFAULT 0.10,
  tenant_weight          DOUBLE PRECISION NOT NULL DEFAULT 0.10,
  updated_by             TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    ABS(
      income_weight + expense_weight + maintenance_weight +
      occupancy_weight + compliance_weight + tenant_weight - 1.0
    ) < 0.00001
  )
);
