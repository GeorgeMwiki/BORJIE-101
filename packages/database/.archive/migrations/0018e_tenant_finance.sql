-- =============================================================================
-- 0018: Tenant financial statement + litigation history
-- =============================================================================
-- Backs SCAFFOLDED-5 (tenant financial statement intake). Two tables with
-- full tenant isolation via cascade-delete FK.
-- =============================================================================

DO $$ BEGIN
  CREATE TYPE financial_statement_status AS ENUM (
    'draft', 'submitted', 'under_review', 'verified', 'rejected', 'expired'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE bank_reference_status AS ENUM (
    'not_requested', 'pending', 'verified', 'failed', 'manual_override'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE litigation_kind AS ENUM (
    'eviction', 'judgment', 'lawsuit_as_plaintiff', 'lawsuit_as_defendant',
    'bankruptcy', 'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE litigation_outcome AS ENUM (
    'pending', 'won', 'lost', 'settled', 'dismissed', 'withdrawn'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS tenant_financial_statements (
  id                            TEXT PRIMARY KEY,
  tenant_id                     TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id                   TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  status                        financial_statement_status NOT NULL DEFAULT 'draft',
  monthly_gross_income          INTEGER NOT NULL DEFAULT 0,
  monthly_net_income            INTEGER NOT NULL DEFAULT 0,
  other_income                  INTEGER NOT NULL DEFAULT 0,
  income_currency               TEXT NOT NULL DEFAULT 'KES',
  income_sources                JSONB NOT NULL DEFAULT '[]'::jsonb,
  monthly_expenses              INTEGER NOT NULL DEFAULT 0,
  monthly_debt_service          INTEGER NOT NULL DEFAULT 0,
  existing_arrears              INTEGER NOT NULL DEFAULT 0,
  employment_status             TEXT,
  employer_name                 TEXT,
  employment_start_date         TIMESTAMPTZ,
  employment_verified_at        TIMESTAMPTZ,
  bank_reference_status         bank_reference_status NOT NULL DEFAULT 'not_requested',
  bank_reference_provider       TEXT,
  bank_reference_requested_at   TIMESTAMPTZ,
  bank_reference_received_at    TIMESTAMPTZ,
  bank_reference_score          DECIMAL(5,2),
  bank_reference_details        JSONB,
  supporting_document_ids       JSONB NOT NULL DEFAULT '[]'::jsonb,
  consent_given                 BOOLEAN NOT NULL DEFAULT FALSE,
  consent_given_at              TIMESTAMPTZ,
  submitted_at                  TIMESTAMPTZ,
  submitted_by                  TEXT,
  verified_at                   TIMESTAMPTZ,
  verified_by                   TEXT,
  rejected_reason               TEXT,
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS tenant_financial_statements_tenant_idx
  ON tenant_financial_statements(tenant_id);
CREATE INDEX IF NOT EXISTS tenant_financial_statements_customer_idx
  ON tenant_financial_statements(customer_id);
CREATE INDEX IF NOT EXISTS tenant_financial_statements_status_idx
  ON tenant_financial_statements(status);

CREATE TABLE IF NOT EXISTS tenant_litigation_history (
  id                      TEXT PRIMARY KEY,
  tenant_id               TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id             TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  kind                    litigation_kind NOT NULL,
  outcome                 litigation_outcome NOT NULL DEFAULT 'pending',
  case_number             TEXT,
  court                   TEXT,
  jurisdiction            TEXT,
  filed_at                TIMESTAMPTZ,
  resolved_at             TIMESTAMPTZ,
  amount_involved         INTEGER,
  currency                TEXT,
  summary                 TEXT,
  evidence_document_ids   JSONB NOT NULL DEFAULT '[]'::jsonb,
  disclosed_by_self       BOOLEAN NOT NULL DEFAULT FALSE,
  verified_at             TIMESTAMPTZ,
  verified_by             TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by              TEXT
);

CREATE INDEX IF NOT EXISTS tenant_litigation_history_tenant_idx
  ON tenant_litigation_history(tenant_id);
CREATE INDEX IF NOT EXISTS tenant_litigation_history_customer_idx
  ON tenant_litigation_history(customer_id);
CREATE INDEX IF NOT EXISTS tenant_litigation_history_kind_idx
  ON tenant_litigation_history(kind);
