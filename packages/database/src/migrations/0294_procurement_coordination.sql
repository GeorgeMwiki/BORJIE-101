-- =============================================================================
-- Migration 0294 — procurement_coordination (vendor registry, budgets,
-- requisitions, approval chains/policies, purchase orders, vendor invoices).
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- `@borjie/procurement-coordination` (createProcurementCoordination) composes
-- focused services — vendor registry, budgets, requisitions, approval engine,
-- purchase orders, invoices (3-way match), spend analytics — over a single
-- `ProcurementDataPort`. Until now that port had only an in-memory
-- implementation (`in-memory-data-port.ts`), so nothing survived a restart and
-- the owner-os procurement surface could only read the separate, junior-
-- produced `procurement_recommendations` table. This migration stands up the
-- REAL core tables the Drizzle `ProcurementDataPort` binds to, so spend
-- analytics, budget availability, vendor performance, and requisition →
-- approval → budget-reservation all run on durable, tenant-isolated rows.
--
-- SCOPE (honest): we model the EIGHT core entities the route surface exercises
-- (vendors, kyc documents, budgets, requisitions, approval chains, approval
-- policies, purchase orders, vendor invoices) plus a small PO-number sequence
-- table. The non-core port collections (catalog, framework agreements, RFQs,
-- bids, goods receipts) are NOT modelled in this wave — their port methods
-- return empty / throw a clear "unsupported collection" error, and the route
-- never invokes them. Nothing is fabricated.
--
-- TENANT SCOPE (CLAUDE.md hard rule — mirrors mig 0285 / 0289):
--   tenant_id is TEXT; every table FORCE-enables ROW LEVEL SECURITY + a tenant
--   policy on the canonical `app.current_tenant_id` GUC (the GUC the
--   api-gateway databaseMiddleware binds). Bare compare (no cast) because
--   tenant_id is already TEXT. NEVER the legacy app.tenant_id.
--
-- CURRENCY NEUTRALITY (CLAUDE.md hard rule): every money column is a `numeric`
-- amount paired with a sibling `currency` TEXT column (ISO-4217). The amount +
-- code travel together; NO currency literal (TZS/USD/…) appears anywhere.
--
-- ID DISCIPLINE: every `id` is TEXT (the package generates string ids), NOT a
-- uuid default — matching the package row ports (`Vendor.id: string`, …).
--
-- FRESH-DB SAFETY / IDEMPOTENCY (CLAUDE.md hard rule: migrations are immutable
-- + forward-only). Every object uses CREATE TABLE IF NOT EXISTS / guarded
-- DO-blocks (pg_policies checks) / CREATE INDEX IF NOT EXISTS, and a pg_roles
-- guard around the anon REVOKE. On a fully-migrated DB this is a pure no-op.
-- References only pre-existing infra (`tenants`).
--
-- Companion files:
--   * packages/database/src/schemas/procurement-coordination.schema.ts
--   * services/api-gateway/src/composition/procurement/drizzle-data-port.ts
--   * services/api-gateway/src/routes/mining/procurement-coordination.hono.ts
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- procurement_vendors
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS procurement_vendors (
  id                    text        PRIMARY KEY,
  tenant_id             text        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  country               text        NOT NULL,
  company_name          text        NOT NULL,
  registration_number   text        NOT NULL DEFAULT '',
  tax_id                text        NOT NULL DEFAULT '',
  kyc_status            text        NOT NULL DEFAULT 'pending',
  categories            jsonb       NOT NULL DEFAULT '[]'::jsonb,
  bank_details          jsonb,
  insurance_expires_at  text,
  certifications        jsonb       NOT NULL DEFAULT '[]'::jsonb,
  rating                numeric,
  preferred_status      text        NOT NULL DEFAULT 'none',
  contact_email         text        NOT NULL DEFAULT '',
  contact_phone         text,
  status_reason         text,
  kyc_decided_at        timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS procurement_vendors_tenant_idx
  ON procurement_vendors (tenant_id);
CREATE INDEX IF NOT EXISTS procurement_vendors_tenant_kyc_idx
  ON procurement_vendors (tenant_id, kyc_status);

-- -----------------------------------------------------------------------------
-- procurement_kyc_documents
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS procurement_kyc_documents (
  id             text        PRIMARY KEY,
  vendor_id      text        NOT NULL REFERENCES procurement_vendors(id) ON DELETE CASCADE,
  tenant_id      text        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  document_type  text        NOT NULL,
  file_url       text        NOT NULL DEFAULT '',
  payload        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS procurement_kyc_documents_vendor_idx
  ON procurement_kyc_documents (vendor_id);
CREATE INDEX IF NOT EXISTS procurement_kyc_documents_tenant_idx
  ON procurement_kyc_documents (tenant_id);

-- -----------------------------------------------------------------------------
-- procurement_budgets
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS procurement_budgets (
  id                    text        PRIMARY KEY,
  tenant_id             text        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  scope                 text        NOT NULL,
  scope_key             text        NOT NULL,
  period                text        NOT NULL,
  period_start          text        NOT NULL,
  period_end            text        NOT NULL,
  amount                numeric     NOT NULL DEFAULT 0,
  currency              text        NOT NULL,
  spent                 numeric     NOT NULL DEFAULT 0,
  committed             numeric     NOT NULL DEFAULT 0,
  reserved              numeric     NOT NULL DEFAULT 0,
  alert_thresholds_pct  jsonb       NOT NULL DEFAULT '[]'::jsonb,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS procurement_budgets_tenant_idx
  ON procurement_budgets (tenant_id);
CREATE INDEX IF NOT EXISTS procurement_budgets_tenant_scope_idx
  ON procurement_budgets (tenant_id, scope, scope_key);

-- -----------------------------------------------------------------------------
-- procurement_requisitions
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS procurement_requisitions (
  id                  text        PRIMARY KEY,
  tenant_id           text        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  requested_by        text        NOT NULL,
  department          text,
  property_id         text,
  items               jsonb       NOT NULL DEFAULT '[]'::jsonb,
  estimated_total     numeric     NOT NULL DEFAULT 0,
  currency            text        NOT NULL,
  justification       text        NOT NULL DEFAULT '',
  urgency             text        NOT NULL DEFAULT 'normal',
  status              text        NOT NULL DEFAULT 'draft',
  budget_id           text,
  approval_chain_id   text,
  rfq_id              text,
  po_id               text,
  submitted_at        timestamptz,
  decided_at          timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS procurement_requisitions_tenant_idx
  ON procurement_requisitions (tenant_id);
CREATE INDEX IF NOT EXISTS procurement_requisitions_tenant_status_idx
  ON procurement_requisitions (tenant_id, status);

-- -----------------------------------------------------------------------------
-- procurement_approval_chains
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS procurement_approval_chains (
  id            text        PRIMARY KEY,
  tenant_id     text        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  subject_kind  text        NOT NULL,
  subject_id    text        NOT NULL,
  amount        numeric     NOT NULL DEFAULT 0,
  currency      text        NOT NULL,
  steps         jsonb       NOT NULL DEFAULT '[]'::jsonb,
  status        text        NOT NULL DEFAULT 'in_flight',
  resolved_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS procurement_approval_chains_tenant_idx
  ON procurement_approval_chains (tenant_id);
CREATE INDEX IF NOT EXISTS procurement_approval_chains_subject_idx
  ON procurement_approval_chains (tenant_id, subject_id);

-- -----------------------------------------------------------------------------
-- procurement_approval_policies
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS procurement_approval_policies (
  id          text        PRIMARY KEY,
  tenant_id   text        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  category    text        NOT NULL,
  thresholds  jsonb       NOT NULL DEFAULT '[]'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS procurement_approval_policies_tenant_category_idx
  ON procurement_approval_policies (tenant_id, category);

-- -----------------------------------------------------------------------------
-- procurement_purchase_orders
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS procurement_purchase_orders (
  id                       text        PRIMARY KEY,
  tenant_id                text        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  tenant_slug              text        NOT NULL DEFAULT '',
  po_number                text        NOT NULL,
  vendor_id                text        NOT NULL,
  requisition_id           text,
  rfq_id                   text,
  bid_id                   text,
  framework_agreement_id   text,
  items                    jsonb       NOT NULL DEFAULT '[]'::jsonb,
  total                    numeric     NOT NULL DEFAULT 0,
  currency                 text        NOT NULL,
  delivery_date            text        NOT NULL DEFAULT '',
  delivery_address         text        NOT NULL DEFAULT '',
  payment_terms            text        NOT NULL DEFAULT '',
  approval_chain_id        text,
  status                   text        NOT NULL DEFAULT 'draft',
  pdf_url                  text,
  issued_at                timestamptz,
  cancelled_at             timestamptz,
  closed_at                timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS procurement_purchase_orders_tenant_idx
  ON procurement_purchase_orders (tenant_id);
CREATE INDEX IF NOT EXISTS procurement_purchase_orders_tenant_vendor_idx
  ON procurement_purchase_orders (tenant_id, vendor_id);
CREATE UNIQUE INDEX IF NOT EXISTS procurement_purchase_orders_po_number_idx
  ON procurement_purchase_orders (tenant_id, po_number);

-- -----------------------------------------------------------------------------
-- procurement_po_sequences — per-(tenant, year) PO-number counter.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS procurement_po_sequences (
  tenant_id  text     NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  year       integer  NOT NULL,
  last_seq   integer  NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS procurement_po_sequences_pk
  ON procurement_po_sequences (tenant_id, year);

-- -----------------------------------------------------------------------------
-- procurement_vendor_invoices
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS procurement_vendor_invoices (
  id                  text        PRIMARY KEY,
  tenant_id           text        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  vendor_id           text        NOT NULL,
  po_id               text        NOT NULL,
  invoice_number      text        NOT NULL,
  line_items          jsonb       NOT NULL DEFAULT '[]'::jsonb,
  total               numeric     NOT NULL DEFAULT 0,
  currency            text        NOT NULL,
  issued_at           text        NOT NULL DEFAULT '',
  due_date            text        NOT NULL DEFAULT '',
  status              text        NOT NULL DEFAULT 'submitted',
  exception_reasons   jsonb       NOT NULL DEFAULT '[]'::jsonb,
  submitted_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS procurement_vendor_invoices_tenant_idx
  ON procurement_vendor_invoices (tenant_id);
CREATE INDEX IF NOT EXISTS procurement_vendor_invoices_tenant_vendor_idx
  ON procurement_vendor_invoices (tenant_id, vendor_id);

-- -----------------------------------------------------------------------------
-- RLS — tenant isolation on the canonical GUC (FORCE so the owner role
-- cannot bypass it either). One policy per table, idempotent.
-- -----------------------------------------------------------------------------

DO $$
DECLARE
  tbl text;
  tables text[] := ARRAY[
    'procurement_vendors',
    'procurement_kyc_documents',
    'procurement_budgets',
    'procurement_requisitions',
    'procurement_approval_chains',
    'procurement_approval_policies',
    'procurement_purchase_orders',
    'procurement_po_sequences',
    'procurement_vendor_invoices'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', tbl);
    EXECUTE format('ALTER TABLE %I FORCE  ROW LEVEL SECURITY;', tbl);
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
       WHERE schemaname = 'public'
         AND tablename  = tbl
         AND policyname = tbl || '_tenant_isolation'
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I FOR ALL '
        || 'USING (tenant_id = current_setting(''app.current_tenant_id'', true)) '
        || 'WITH CHECK (tenant_id = current_setting(''app.current_tenant_id'', true));',
        tbl || '_tenant_isolation', tbl
      );
    END IF;
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- Lock down the anon role (Supabase-only; guarded for vanilla Postgres / CI).
-- -----------------------------------------------------------------------------

DO $$
DECLARE
  tbl text;
  tables text[] := ARRAY[
    'procurement_vendors',
    'procurement_kyc_documents',
    'procurement_budgets',
    'procurement_requisitions',
    'procurement_approval_chains',
    'procurement_approval_policies',
    'procurement_purchase_orders',
    'procurement_po_sequences',
    'procurement_vendor_invoices'
  ];
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    FOREACH tbl IN ARRAY tables LOOP
      EXECUTE format('REVOKE ALL ON public.%I FROM anon;', tbl);
    END LOOP;
  END IF;
END $$;

COMMIT;
