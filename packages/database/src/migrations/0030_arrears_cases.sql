-- Migration: Arrears Cases (NEW 4 follow-up)
--
-- The main payment schema already declares `arrears_cases` in drizzle
-- but the corresponding CREATE TABLE never landed in the numbered
-- migration sequence. This migration adds the table so the arrears
-- repository can persist case rows and the projection loader can
-- resolve (customerId, currency) for cases that have no proposals
-- yet (newly opened, zero-balance projections).
--
-- Ledger invariant: this table holds the CASE header. The immutable
-- ledger itself lives in `transactions` + `arrears_line_proposals`;
-- nothing here changes the append-only semantics.

DO $$ BEGIN
  CREATE TYPE arrears_status AS ENUM (
    'active',
    'payment_plan',
    'promise_to_pay',
    'escalated',
    'legal',
    'resolved',
    'written_off'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS arrears_cases (
  id                         TEXT PRIMARY KEY,
  tenant_id                  TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id                TEXT NOT NULL REFERENCES customers(id),
  lease_id                   TEXT,
  property_id                TEXT,
  unit_id                    TEXT,

  case_number                TEXT NOT NULL,
  status                     arrears_status NOT NULL DEFAULT 'active',

  total_arrears_amount       INTEGER NOT NULL,
  current_balance            INTEGER NOT NULL,
  currency                   TEXT NOT NULL,

  days_past_due              INTEGER NOT NULL DEFAULT 0,
  aging_bucket               TEXT NOT NULL DEFAULT 'current',

  overdue_invoices           JSONB DEFAULT '[]'::jsonb,

  payment_plan_id            TEXT,
  current_ladder_step        INTEGER DEFAULT 0,
  ladder_history             JSONB DEFAULT '[]'::jsonb,
  last_contact_at            TIMESTAMPTZ,
  next_action_at             TIMESTAMPTZ,

  legal_case_id              TEXT,
  legal_action_initiated_at  TIMESTAMPTZ,

  promise_to_pay_date        TIMESTAMPTZ,
  promise_to_pay_amount      INTEGER,
  promise_broken             BOOLEAN DEFAULT false,

  assigned_to                TEXT,
  assigned_at                TIMESTAMPTZ,

  resolved_at                TIMESTAMPTZ,
  resolved_by                TEXT,
  resolution_type            TEXT,
  resolution_notes           TEXT,

  written_off_at             TIMESTAMPTZ,
  written_off_by             TEXT,
  written_off_amount         INTEGER,
  write_off_reason           TEXT,

  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by                 TEXT,
  updated_by                 TEXT
);

CREATE INDEX IF NOT EXISTS arrears_cases_tenant_idx
  ON arrears_cases(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS arrears_cases_case_number_tenant_idx
  ON arrears_cases(tenant_id, case_number);
CREATE INDEX IF NOT EXISTS arrears_cases_customer_idx
  ON arrears_cases(customer_id);
CREATE INDEX IF NOT EXISTS arrears_cases_lease_idx
  ON arrears_cases(lease_id);
CREATE INDEX IF NOT EXISTS arrears_cases_status_idx
  ON arrears_cases(status);
CREATE INDEX IF NOT EXISTS arrears_cases_aging_bucket_idx
  ON arrears_cases(aging_bucket);
CREATE INDEX IF NOT EXISTS arrears_cases_next_action_at_idx
  ON arrears_cases(next_action_at);
