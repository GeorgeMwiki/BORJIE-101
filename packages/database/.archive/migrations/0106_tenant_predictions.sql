-- =============================================================================
-- 0106: Tenant predictions (predictive intervention engine)
-- =============================================================================
-- Nightly per-tenant probability distribution over well-defined outcomes for
-- the next 30/60/90 days. Combines payment history, sentiment-monitor rollups,
-- credit rating, tenancy length, cases, messages. Every prediction carries
-- model_version + confidence + explanation so humans can audit.
-- =============================================================================

CREATE TABLE IF NOT EXISTS tenant_predictions (
  id                    TEXT PRIMARY KEY,
  tenant_id             TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id           TEXT NOT NULL,
  horizon_days          INTEGER NOT NULL CHECK (horizon_days IN (30, 60, 90)),
  prob_pay_on_time      DOUBLE PRECISION NOT NULL CHECK (prob_pay_on_time BETWEEN 0 AND 1),
  prob_pay_late         DOUBLE PRECISION NOT NULL CHECK (prob_pay_late BETWEEN 0 AND 1),
  prob_default          DOUBLE PRECISION NOT NULL CHECK (prob_default BETWEEN 0 AND 1),
  prob_churn            DOUBLE PRECISION NOT NULL CHECK (prob_churn BETWEEN 0 AND 1),
  prob_dispute          DOUBLE PRECISION NOT NULL CHECK (prob_dispute BETWEEN 0 AND 1),
  model_version         TEXT NOT NULL,
  confidence            DOUBLE PRECISION NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  explanation           TEXT,
  feature_snapshot      JSONB NOT NULL DEFAULT '{}'::jsonb,
  prompt_hash           TEXT,
  computed_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tenant_predictions_customer_horizon_time
  ON tenant_predictions (tenant_id, customer_id, horizon_days, computed_at DESC);

-- Emitted when any probability crosses threshold; the advisor surfaces these
CREATE TABLE IF NOT EXISTS predictive_intervention_opportunities (
  id                    TEXT PRIMARY KEY,
  tenant_id             TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id           TEXT NOT NULL,
  prediction_id         TEXT,
  signal_type           TEXT NOT NULL,                          -- 'high_default_risk' | 'high_churn_risk' | ...
  signal_strength       DOUBLE PRECISION NOT NULL CHECK (signal_strength BETWEEN 0 AND 1),
  suggested_action      TEXT,
  status                TEXT NOT NULL DEFAULT 'open'
                          CHECK (status IN ('open','acknowledged','acted','dismissed')),
  metadata              JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_predictive_interventions_open
  ON predictive_intervention_opportunities (tenant_id, status, created_at DESC)
  WHERE status IN ('open', 'acknowledged');
