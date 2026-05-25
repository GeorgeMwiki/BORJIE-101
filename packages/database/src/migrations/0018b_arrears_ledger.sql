-- Migration: Arrears Ledger (NEW 4)
-- MISSING_FEATURES_DESIGN.md §4 — ledger remains immutable; adjustments
-- are append-only entries referencing related_entry_id.

DO $$ BEGIN
  CREATE TYPE arrears_proposal_status AS ENUM ('pending','approved','rejected','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE arrears_proposal_kind AS ENUM ('waiver','writeoff','late_fee','adjustment','correction');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS arrears_line_proposals (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id text NOT NULL REFERENCES customers(id),
  arrears_case_id text NOT NULL,
  invoice_id text REFERENCES invoices(id),
  kind arrears_proposal_kind NOT NULL,
  amount_minor_units integer NOT NULL,
  currency text NOT NULL,
  reason text NOT NULL,
  evidence_doc_ids jsonb DEFAULT '[]',
  status arrears_proposal_status NOT NULL DEFAULT 'pending',
  proposed_by text NOT NULL,
  proposed_at timestamptz NOT NULL DEFAULT now(),
  approved_by text,
  approved_at timestamptz,
  approval_notes text,
  rejected_by text,
  rejected_at timestamptz,
  rejection_reason text,
  related_entry_id text,
  balance_before_minor_units integer,
  projected_balance_after_minor_units integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS arrears_prop_tenant_idx ON arrears_line_proposals(tenant_id);
CREATE INDEX IF NOT EXISTS arrears_prop_case_idx ON arrears_line_proposals(arrears_case_id);
CREATE INDEX IF NOT EXISTS arrears_prop_customer_idx ON arrears_line_proposals(customer_id);
CREATE INDEX IF NOT EXISTS arrears_prop_status_idx ON arrears_line_proposals(status);
CREATE INDEX IF NOT EXISTS arrears_prop_related_entry_idx ON arrears_line_proposals(related_entry_id);
CREATE INDEX IF NOT EXISTS arrears_prop_proposed_at_idx ON arrears_line_proposals(proposed_at);

CREATE TABLE IF NOT EXISTS arrears_case_projections (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  arrears_case_id text NOT NULL,
  customer_id text NOT NULL,
  balance_minor_units integer NOT NULL,
  currency text NOT NULL,
  days_past_due integer NOT NULL DEFAULT 0,
  aging_bucket text NOT NULL,
  last_ledger_entry_id text,
  replayed_entry_count integer NOT NULL DEFAULT 0,
  lines jsonb NOT NULL DEFAULT '[]',
  as_of timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS arrears_proj_tenant_idx ON arrears_case_projections(tenant_id);
CREATE INDEX IF NOT EXISTS arrears_proj_case_idx ON arrears_case_projections(arrears_case_id);
CREATE INDEX IF NOT EXISTS arrears_proj_customer_idx ON arrears_case_projections(customer_id);
CREATE INDEX IF NOT EXISTS arrears_proj_as_of_idx ON arrears_case_projections(as_of);
CREATE UNIQUE INDEX IF NOT EXISTS arrears_proj_case_as_of_uniq ON arrears_case_projections(arrears_case_id, as_of);
