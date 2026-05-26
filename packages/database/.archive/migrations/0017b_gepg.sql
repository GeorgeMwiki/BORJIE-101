-- Migration: GePG (Government e-Payment Gateway) integration
-- Feature: NEW 3 (Docs/analysis/MISSING_FEATURES_DESIGN.md §3)

-- Enums
DO $$ BEGIN
  CREATE TYPE gepg_control_number_status AS ENUM (
    'pending','issued','rejected','paid','partial','expired','cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE gepg_recon_event_type AS ENUM (
    'cn_requested','cn_issued','cn_rejected','callback_received',
    'callback_signature_failed','reconciled','reconciliation_failed',
    'duplicate_detected'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Control Numbers
CREATE TABLE IF NOT EXISTS gepg_control_numbers (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  invoice_id text NOT NULL REFERENCES invoices(id),
  bill_id text NOT NULL,
  control_number text,
  sp_code text NOT NULL,
  sp_sys_id text NOT NULL,
  status gepg_control_number_status NOT NULL DEFAULT 'pending',
  amount_minor_units integer NOT NULL,
  currency text NOT NULL,
  paid_amount_minor_units integer NOT NULL DEFAULT 0,
  payer_name text NOT NULL,
  payer_phone text,
  payer_email text,
  description text,
  issued_at timestamptz,
  expires_at timestamptz,
  paid_at timestamptz,
  cancelled_at timestamptz,
  psp_receipt_number text,
  psp_channel text,
  raw_provider_response jsonb DEFAULT '{}',
  environment text NOT NULL DEFAULT 'sandbox',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text
);

CREATE INDEX IF NOT EXISTS gepg_cn_tenant_idx ON gepg_control_numbers(tenant_id);
CREATE INDEX IF NOT EXISTS gepg_cn_invoice_idx ON gepg_control_numbers(invoice_id);
CREATE UNIQUE INDEX IF NOT EXISTS gepg_cn_control_number_uniq ON gepg_control_numbers(control_number);
CREATE UNIQUE INDEX IF NOT EXISTS gepg_cn_bill_id_tenant_uniq ON gepg_control_numbers(tenant_id, bill_id);
CREATE INDEX IF NOT EXISTS gepg_cn_status_idx ON gepg_control_numbers(status);

-- Reconciliation Events (append-only)
CREATE TABLE IF NOT EXISTS gepg_reconciliation_events (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  control_number_id text REFERENCES gepg_control_numbers(id),
  payment_id text REFERENCES payments(id),
  event_type gepg_recon_event_type NOT NULL,
  control_number text,
  bill_id text,
  payload jsonb NOT NULL DEFAULT '{}',
  signature_valid text,
  signature_reason text,
  dedup_key text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text
);

CREATE INDEX IF NOT EXISTS gepg_recon_tenant_idx ON gepg_reconciliation_events(tenant_id);
CREATE INDEX IF NOT EXISTS gepg_recon_control_number_idx ON gepg_reconciliation_events(control_number);
CREATE UNIQUE INDEX IF NOT EXISTS gepg_recon_dedup_uniq ON gepg_reconciliation_events(dedup_key);
CREATE INDEX IF NOT EXISTS gepg_recon_event_type_idx ON gepg_reconciliation_events(event_type);
CREATE INDEX IF NOT EXISTS gepg_recon_occurred_at_idx ON gepg_reconciliation_events(occurred_at);
