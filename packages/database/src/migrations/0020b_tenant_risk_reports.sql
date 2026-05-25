-- =============================================================================
-- 0020: Tenant risk reports
-- =============================================================================
-- Composite risk report per customer. `snapshot` stores the deterministic
-- scores so the report is reproducible independent of the LLM narration.
-- =============================================================================

DO $$ BEGIN
  CREATE TYPE tenant_risk_report_status AS ENUM (
    'draft', 'generated', 'archived'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS tenant_risk_reports (
  id                         TEXT PRIMARY KEY,
  tenant_id                  TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id                TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  status                     tenant_risk_report_status NOT NULL DEFAULT 'draft',
  report_version             TEXT NOT NULL DEFAULT 'v1',
  payment_risk_score         INTEGER NOT NULL,
  payment_risk_level         TEXT NOT NULL,
  churn_risk_score           INTEGER NOT NULL,
  churn_risk_level           TEXT NOT NULL,
  financial_statement_id     TEXT,
  litigation_count           INTEGER NOT NULL DEFAULT 0,
  snapshot                   JSONB NOT NULL,
  narrative                  TEXT,
  recommendations            JSONB NOT NULL DEFAULT '[]'::jsonb,
  generated_at               TIMESTAMPTZ,
  generated_by               TEXT,
  generated_by_model         TEXT,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS tenant_risk_reports_tenant_idx
  ON tenant_risk_reports(tenant_id);
CREATE INDEX IF NOT EXISTS tenant_risk_reports_customer_idx
  ON tenant_risk_reports(customer_id);
CREATE INDEX IF NOT EXISTS tenant_risk_reports_status_idx
  ON tenant_risk_reports(status);
CREATE INDEX IF NOT EXISTS tenant_risk_reports_generated_at_idx
  ON tenant_risk_reports(generated_at);
