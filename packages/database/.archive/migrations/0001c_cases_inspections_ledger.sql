-- =============================================================================
-- 0001c: Base tables for cases, inspections, ledger (accounts, ledger_entries)
-- =============================================================================
-- These tables exist as Drizzle schemas (cases.schema.ts, inspections.schema.ts,
-- ledger.schema.ts) but had no prior matching SQL migration, so later
-- migrations (0014, 0015, 0017*, 0018c_conditional_surveys, 0025, 0026) broke
-- when run from a fresh DB under ON_ERROR_STOP.
--
-- This migration is additive and uses IF NOT EXISTS throughout so it is safe
-- to run against environments where the tables were previously created via
-- `drizzle push` or other mechanisms.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- Cases enums
-- ----------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE case_type AS ENUM (
    'arrears', 'deposit_dispute', 'damage_claim', 'lease_violation',
    'noise_complaint', 'maintenance_dispute', 'eviction', 'harassment',
    'safety_concern', 'billing_dispute', 'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE case_severity AS ENUM (
    'low', 'medium', 'high', 'critical', 'urgent'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE case_status AS ENUM (
    'open', 'investigating', 'pending_response', 'pending_evidence',
    'mediation', 'escalated', 'resolved', 'closed', 'withdrawn'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ----------------------------------------------------------------------------
-- Cases table (cases.schema.ts)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cases (
  id                           TEXT PRIMARY KEY,
  tenant_id                    TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  property_id                  TEXT REFERENCES properties(id) ON DELETE SET NULL,
  unit_id                      TEXT REFERENCES units(id) ON DELETE SET NULL,
  customer_id                  TEXT REFERENCES customers(id) ON DELETE SET NULL,
  lease_id                     TEXT REFERENCES leases(id) ON DELETE SET NULL,
  case_number                  TEXT NOT NULL,
  case_type                    case_type NOT NULL,
  severity                     case_severity NOT NULL DEFAULT 'medium',
  status                       case_status NOT NULL DEFAULT 'open',
  title                        TEXT NOT NULL,
  description                  TEXT,
  amount_in_dispute            INTEGER,
  currency                     TEXT,
  response_due_at              TIMESTAMPTZ,
  resolution_due_at            TIMESTAMPTZ,
  sla_breached                 BOOLEAN NOT NULL DEFAULT FALSE,
  assigned_to                  TEXT,
  assigned_at                  TIMESTAMPTZ,
  assigned_by                  TEXT,
  escalated_at                 TIMESTAMPTZ,
  escalated_to                 TEXT,
  escalation_reason            TEXT,
  escalation_level             INTEGER DEFAULT 0,
  parent_case_id               TEXT,
  tags                         JSONB DEFAULT '[]'::jsonb,
  resolved_at                  TIMESTAMPTZ,
  resolved_by                  TEXT,
  closed_at                    TIMESTAMPTZ,
  closed_by                    TEXT,
  closure_reason               TEXT,
  customer_satisfaction_rating INTEGER,
  customer_feedback            TEXT,
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by                   TEXT,
  updated_by                   TEXT,
  deleted_at                   TIMESTAMPTZ,
  deleted_by                   TEXT
);

CREATE INDEX IF NOT EXISTS cases_tenant_idx            ON cases(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS cases_case_number_tenant_idx ON cases(tenant_id, case_number);
CREATE INDEX IF NOT EXISTS cases_property_idx          ON cases(property_id);
CREATE INDEX IF NOT EXISTS cases_unit_idx              ON cases(unit_id);
CREATE INDEX IF NOT EXISTS cases_customer_idx          ON cases(customer_id);
CREATE INDEX IF NOT EXISTS cases_lease_idx             ON cases(lease_id);
CREATE INDEX IF NOT EXISTS cases_type_idx              ON cases(case_type);
CREATE INDEX IF NOT EXISTS cases_severity_idx          ON cases(severity);
CREATE INDEX IF NOT EXISTS cases_status_idx            ON cases(status);
CREATE INDEX IF NOT EXISTS cases_assigned_to_idx       ON cases(assigned_to);
CREATE INDEX IF NOT EXISTS cases_resolution_due_at_idx ON cases(resolution_due_at);

ALTER TABLE cases ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY cases_tenant_isolation ON cases
    USING (tenant_id = current_setting('app.current_tenant_id', TRUE));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ----------------------------------------------------------------------------
-- Inspections enums
-- ----------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE inspection_type AS ENUM (
    'move_in', 'move_out', 'routine', 'periodic', 'preventive',
    'complaint', 'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE inspection_status AS ENUM (
    'scheduled', 'in_progress', 'completed', 'cancelled', 'deferred'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ----------------------------------------------------------------------------
-- Inspections table (inspections.schema.ts)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inspections (
  id              TEXT PRIMARY KEY,
  tenant_id       TEXT REFERENCES tenants(id) ON DELETE CASCADE,
  property_id     TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  unit_id         TEXT REFERENCES units(id) ON DELETE SET NULL,
  inspector_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  type            inspection_type NOT NULL DEFAULT 'routine',
  status          inspection_status NOT NULL DEFAULT 'scheduled',
  scheduled_date  TIMESTAMPTZ,
  completed_date  TIMESTAMPTZ,
  notes           TEXT,
  summary         TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by      TEXT,
  updated_by      TEXT,
  deleted_at      TIMESTAMPTZ,
  deleted_by      TEXT
);

CREATE INDEX IF NOT EXISTS inspections_tenant_idx         ON inspections(tenant_id);
CREATE INDEX IF NOT EXISTS inspections_property_idx       ON inspections(property_id);
CREATE INDEX IF NOT EXISTS inspections_unit_idx           ON inspections(unit_id);
CREATE INDEX IF NOT EXISTS inspections_inspector_idx      ON inspections(inspector_id);
CREATE INDEX IF NOT EXISTS inspections_type_idx           ON inspections(type);
CREATE INDEX IF NOT EXISTS inspections_status_idx         ON inspections(status);
CREATE INDEX IF NOT EXISTS inspections_scheduled_date_idx ON inspections(scheduled_date);
CREATE INDEX IF NOT EXISTS inspections_completed_date_idx ON inspections(completed_date);

ALTER TABLE inspections ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY inspections_tenant_isolation ON inspections
    USING (tenant_id = current_setting('app.current_tenant_id', TRUE));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ----------------------------------------------------------------------------
-- Ledger: accounts + ledger_entries (ledger.schema.ts)
-- ----------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE account_type AS ENUM (
    'CUSTOMER_LIABILITY', 'CUSTOMER_DEPOSIT', 'OWNER_OPERATING',
    'OWNER_RESERVE', 'PLATFORM_REVENUE', 'PLATFORM_HOLDING',
    'TRUST_ACCOUNT', 'EXPENSE', 'ASSET'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE account_status AS ENUM ('ACTIVE', 'SUSPENDED', 'CLOSED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE ledger_entry_type AS ENUM (
    'RENT_CHARGE', 'RENT_PAYMENT', 'DEPOSIT_CHARGE', 'DEPOSIT_PAYMENT',
    'DEPOSIT_REFUND', 'LATE_FEE', 'MAINTENANCE_CHARGE', 'UTILITY_CHARGE',
    'OWNER_CONTRIBUTION', 'OWNER_DISBURSEMENT', 'PLATFORM_FEE',
    'PAYMENT_PROCESSING_FEE', 'REFUND', 'ADJUSTMENT', 'WRITE_OFF',
    'TRANSFER_IN', 'TRANSFER_OUT'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE entry_direction AS ENUM ('DEBIT', 'CREDIT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS accounts (
  id                   TEXT PRIMARY KEY,
  tenant_id            TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id          TEXT REFERENCES customers(id),
  owner_id             TEXT,
  property_id          TEXT REFERENCES properties(id),
  name                 TEXT NOT NULL,
  type                 account_type NOT NULL,
  status               account_status NOT NULL DEFAULT 'ACTIVE',
  currency             TEXT NOT NULL,
  balance_minor_units  INTEGER NOT NULL DEFAULT 0,
  last_entry_id        TEXT,
  last_entry_at        TIMESTAMPTZ,
  entry_count          INTEGER NOT NULL DEFAULT 0,
  description          TEXT,
  metadata             JSONB DEFAULT '{}'::jsonb,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by           TEXT,
  updated_by           TEXT,
  closed_at            TIMESTAMPTZ,
  closed_by            TEXT
);

CREATE INDEX IF NOT EXISTS accounts_tenant_idx   ON accounts(tenant_id);
CREATE INDEX IF NOT EXISTS accounts_customer_idx ON accounts(customer_id);
CREATE INDEX IF NOT EXISTS accounts_owner_idx    ON accounts(owner_id);
CREATE INDEX IF NOT EXISTS accounts_property_idx ON accounts(property_id);
CREATE INDEX IF NOT EXISTS accounts_type_idx     ON accounts(type);
CREATE INDEX IF NOT EXISTS accounts_status_idx   ON accounts(status);
CREATE UNIQUE INDEX IF NOT EXISTS accounts_customer_type_idx ON accounts(tenant_id, customer_id, type);
CREATE UNIQUE INDEX IF NOT EXISTS accounts_owner_type_idx    ON accounts(tenant_id, owner_id, type);

ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY accounts_tenant_isolation ON accounts
    USING (tenant_id = current_setting('app.current_tenant_id', TRUE));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS ledger_entries (
  id                          TEXT PRIMARY KEY,
  tenant_id                   TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  account_id                  TEXT NOT NULL REFERENCES accounts(id),
  journal_id                  TEXT NOT NULL,
  type                        ledger_entry_type NOT NULL,
  direction                   entry_direction NOT NULL,
  amount_minor_units          INTEGER NOT NULL,
  currency                    TEXT NOT NULL,
  balance_after_minor_units   INTEGER NOT NULL,
  sequence_number             INTEGER NOT NULL,
  effective_date              TIMESTAMPTZ NOT NULL,
  posted_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  payment_intent_id           TEXT,
  lease_id                    TEXT REFERENCES leases(id),
  property_id                 TEXT REFERENCES properties(id),
  unit_id                     TEXT REFERENCES units(id),
  invoice_id                  TEXT,
  description                 TEXT,
  metadata                    JSONB DEFAULT '{}'::jsonb,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by                  TEXT
);

CREATE INDEX IF NOT EXISTS ledger_entries_tenant_idx           ON ledger_entries(tenant_id);
CREATE INDEX IF NOT EXISTS ledger_entries_account_idx          ON ledger_entries(account_id);
CREATE INDEX IF NOT EXISTS ledger_entries_journal_idx          ON ledger_entries(journal_id);
CREATE INDEX IF NOT EXISTS ledger_entries_type_idx             ON ledger_entries(type);
CREATE INDEX IF NOT EXISTS ledger_entries_effective_date_idx   ON ledger_entries(effective_date);
CREATE INDEX IF NOT EXISTS ledger_entries_payment_intent_idx   ON ledger_entries(payment_intent_id);
CREATE INDEX IF NOT EXISTS ledger_entries_lease_idx            ON ledger_entries(lease_id);
CREATE UNIQUE INDEX IF NOT EXISTS ledger_entries_account_sequence_idx ON ledger_entries(account_id, sequence_number);
CREATE INDEX IF NOT EXISTS ledger_entries_posted_at_idx        ON ledger_entries(posted_at);

ALTER TABLE ledger_entries ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY ledger_entries_tenant_isolation ON ledger_entries
    USING (tenant_id = current_setting('app.current_tenant_id', TRUE));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- End of 0001c
