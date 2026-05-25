-- =============================================================================
-- 0019: Intelligence history (daily snapshots)
-- =============================================================================
-- Append-only per-customer snapshot table used for trend lines and retroactive
-- audits of risk / churn scoring.
-- =============================================================================

CREATE TABLE IF NOT EXISTS intelligence_history (
  id                            TEXT PRIMARY KEY,
  tenant_id                     TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id                   TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  snapshot_date                 DATE NOT NULL,
  payment_risk_score            INTEGER,
  payment_risk_level            TEXT,
  churn_risk_score              INTEGER,
  churn_risk_level              TEXT,
  sentiment_score               DECIMAL(4,2),
  open_maintenance_count        INTEGER NOT NULL DEFAULT 0,
  complaints_last_30_days       INTEGER NOT NULL DEFAULT 0,
  payments_last_30_days_on_time INTEGER NOT NULL DEFAULT 0,
  payments_last_30_days_late    INTEGER NOT NULL DEFAULT 0,
  payment_sub_scores            JSONB,
  churn_sub_scores              JSONB,
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS intelligence_history_tenant_idx
  ON intelligence_history(tenant_id);
CREATE INDEX IF NOT EXISTS intelligence_history_customer_idx
  ON intelligence_history(customer_id);
CREATE INDEX IF NOT EXISTS intelligence_history_date_idx
  ON intelligence_history(snapshot_date);
CREATE UNIQUE INDEX IF NOT EXISTS intelligence_history_customer_date_unique
  ON intelligence_history(tenant_id, customer_id, snapshot_date);
