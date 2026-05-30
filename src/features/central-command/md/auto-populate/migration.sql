-- ==========================================================================
-- Auto-Populate Engine — Tables
--
-- Silent chat-to-structured-data extractor. Every row is tenant-scoped,
-- RLS-enforced, and idempotent on (tenant_id, canonical_name).
--
-- Tables created:
--   ap_employees, ap_customers, ap_products, ap_suppliers,
--   ap_meetings, ap_decisions, ap_feedback, ap_goals, ap_projects,
--   ap_risks, ap_opportunities,
--   auto_populate_audit
--
-- RLS posture:
--   ENABLE ROW LEVEL SECURITY + FORCE ROW LEVEL SECURITY on every table.
--   Service role bypasses for backend writes; otherwise tenant isolation
--   via the platform's `get_current_org_id()` helper (declared in earlier
--   migrations).
--
-- Naming: tables are prefixed `ap_` (auto-populate) to avoid colliding
-- with any pre-existing `customers`, `products`, etc. inside the wider
-- platform schema.
-- ==========================================================================

-- --------------------------------------------------------------------------
-- ENUMS
-- --------------------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE ap_customer_status AS ENUM ('prospect', 'active', 'churned', 'paused');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE ap_supplier_criticality AS ENUM ('low', 'medium', 'high');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE ap_feedback_sentiment AS ENUM ('positive', 'neutral', 'negative');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE ap_project_status AS ENUM ('proposed', 'active', 'blocked', 'shipped', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE ap_risk_severity AS ENUM ('low', 'medium', 'high', 'critical');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE ap_risk_likelihood AS ENUM ('unlikely', 'possible', 'likely', 'certain');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE ap_opportunity_horizon AS ENUM ('now', 'this-quarter', 'this-year', 'long-term');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE ap_gate_decision AS ENUM ('auto_persist', 'confirm_needed', 'drop');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE ap_dedupe_action AS ENUM ('insert', 'merge');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE ap_owner_confirmation AS ENUM ('auto', 'pending', 'confirmed', 'rejected', 'reverted');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- --------------------------------------------------------------------------
-- SHARED BASE COLUMN BLOCK
-- Every ap_* row carries the same identity + provenance columns. We inline
-- them per-table (no inheritance, easier RLS reasoning).
-- --------------------------------------------------------------------------

-- ap_employees
CREATE TABLE IF NOT EXISTS ap_employees (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  canonical_name  TEXT NOT NULL,
  display_name    TEXT NOT NULL,
  confidence      NUMERIC(4,3) NOT NULL DEFAULT 0,
  notes           TEXT,
  source_span     JSONB,
  created_by      UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  role            TEXT,
  department      TEXT,
  email           TEXT,
  phone           TEXT,
  start_date      TEXT,
  is_new_hire     BOOLEAN
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ap_employees_tenant_canon
  ON ap_employees (tenant_id, canonical_name);
CREATE INDEX IF NOT EXISTS idx_ap_employees_tenant ON ap_employees (tenant_id);

-- ap_customers
CREATE TABLE IF NOT EXISTS ap_customers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  canonical_name  TEXT NOT NULL,
  display_name    TEXT NOT NULL,
  confidence      NUMERIC(4,3) NOT NULL DEFAULT 0,
  notes           TEXT,
  source_span     JSONB,
  created_by      UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  industry        TEXT,
  contact_name    TEXT,
  contact_email   TEXT,
  contact_phone   TEXT,
  arr_usd         NUMERIC,
  signed_date     TEXT,
  status          ap_customer_status
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ap_customers_tenant_canon
  ON ap_customers (tenant_id, canonical_name);
CREATE INDEX IF NOT EXISTS idx_ap_customers_tenant ON ap_customers (tenant_id);

-- ap_products
CREATE TABLE IF NOT EXISTS ap_products (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  canonical_name  TEXT NOT NULL,
  display_name    TEXT NOT NULL,
  confidence      NUMERIC(4,3) NOT NULL DEFAULT 0,
  notes           TEXT,
  source_span     JSONB,
  created_by      UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  sku             TEXT,
  category        TEXT,
  price_usd       NUMERIC,
  is_top_seller   BOOLEAN,
  margin          NUMERIC
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ap_products_tenant_canon
  ON ap_products (tenant_id, canonical_name);
CREATE INDEX IF NOT EXISTS idx_ap_products_tenant ON ap_products (tenant_id);

-- ap_suppliers
CREATE TABLE IF NOT EXISTS ap_suppliers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  canonical_name  TEXT NOT NULL,
  display_name    TEXT NOT NULL,
  confidence      NUMERIC(4,3) NOT NULL DEFAULT 0,
  notes           TEXT,
  source_span     JSONB,
  created_by      UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  category               TEXT,
  contact_name           TEXT,
  contact_email          TEXT,
  contact_phone          TEXT,
  annual_spend_usd       NUMERIC,
  criticality            ap_supplier_criticality,
  contract_renewal_date  TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ap_suppliers_tenant_canon
  ON ap_suppliers (tenant_id, canonical_name);
CREATE INDEX IF NOT EXISTS idx_ap_suppliers_tenant ON ap_suppliers (tenant_id);

-- ap_meetings
CREATE TABLE IF NOT EXISTS ap_meetings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  canonical_name  TEXT NOT NULL,
  display_name    TEXT NOT NULL,
  confidence      NUMERIC(4,3) NOT NULL DEFAULT 0,
  notes           TEXT,
  source_span     JSONB,
  created_by      UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  occurred_at     TEXT,
  attendees       TEXT[],
  topic           TEXT,
  outcome         TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ap_meetings_tenant_canon
  ON ap_meetings (tenant_id, canonical_name);
CREATE INDEX IF NOT EXISTS idx_ap_meetings_tenant ON ap_meetings (tenant_id);

-- ap_decisions
CREATE TABLE IF NOT EXISTS ap_decisions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  canonical_name  TEXT NOT NULL,
  display_name    TEXT NOT NULL,
  confidence      NUMERIC(4,3) NOT NULL DEFAULT 0,
  notes           TEXT,
  source_span     JSONB,
  created_by      UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  decided_at      TEXT,
  rationale       TEXT,
  impact_area     TEXT,
  reversible      BOOLEAN
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ap_decisions_tenant_canon
  ON ap_decisions (tenant_id, canonical_name);
CREATE INDEX IF NOT EXISTS idx_ap_decisions_tenant ON ap_decisions (tenant_id);

-- ap_feedback
CREATE TABLE IF NOT EXISTS ap_feedback (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  canonical_name  TEXT NOT NULL,
  display_name    TEXT NOT NULL,
  confidence      NUMERIC(4,3) NOT NULL DEFAULT 0,
  notes           TEXT,
  source_span     JSONB,
  created_by      UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  source          TEXT,
  sentiment       ap_feedback_sentiment,
  topic           TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ap_feedback_tenant_canon
  ON ap_feedback (tenant_id, canonical_name);
CREATE INDEX IF NOT EXISTS idx_ap_feedback_tenant ON ap_feedback (tenant_id);

-- ap_goals
CREATE TABLE IF NOT EXISTS ap_goals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  canonical_name  TEXT NOT NULL,
  display_name    TEXT NOT NULL,
  confidence      NUMERIC(4,3) NOT NULL DEFAULT 0,
  notes           TEXT,
  source_span     JSONB,
  created_by      UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  target_date     TEXT,
  metric          TEXT,
  target_value    NUMERIC,
  owner           TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ap_goals_tenant_canon
  ON ap_goals (tenant_id, canonical_name);
CREATE INDEX IF NOT EXISTS idx_ap_goals_tenant ON ap_goals (tenant_id);

-- ap_projects
CREATE TABLE IF NOT EXISTS ap_projects (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  canonical_name  TEXT NOT NULL,
  display_name    TEXT NOT NULL,
  confidence      NUMERIC(4,3) NOT NULL DEFAULT 0,
  notes           TEXT,
  source_span     JSONB,
  created_by      UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  status          ap_project_status,
  started_at      TEXT,
  due_date        TEXT,
  owner           TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ap_projects_tenant_canon
  ON ap_projects (tenant_id, canonical_name);
CREATE INDEX IF NOT EXISTS idx_ap_projects_tenant ON ap_projects (tenant_id);

-- ap_risks
CREATE TABLE IF NOT EXISTS ap_risks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  canonical_name  TEXT NOT NULL,
  display_name    TEXT NOT NULL,
  confidence      NUMERIC(4,3) NOT NULL DEFAULT 0,
  notes           TEXT,
  source_span     JSONB,
  created_by      UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  severity        ap_risk_severity,
  likelihood      ap_risk_likelihood,
  mitigation      TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ap_risks_tenant_canon
  ON ap_risks (tenant_id, canonical_name);
CREATE INDEX IF NOT EXISTS idx_ap_risks_tenant ON ap_risks (tenant_id);

-- ap_opportunities
CREATE TABLE IF NOT EXISTS ap_opportunities (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  canonical_name  TEXT NOT NULL,
  display_name    TEXT NOT NULL,
  confidence      NUMERIC(4,3) NOT NULL DEFAULT 0,
  notes           TEXT,
  source_span     JSONB,
  created_by      UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  estimated_value_usd NUMERIC,
  probability         NUMERIC,
  horizon             ap_opportunity_horizon
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ap_opportunities_tenant_canon
  ON ap_opportunities (tenant_id, canonical_name);
CREATE INDEX IF NOT EXISTS idx_ap_opportunities_tenant ON ap_opportunities (tenant_id);

-- --------------------------------------------------------------------------
-- AUDIT TRAIL
-- --------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS auto_populate_audit (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID NOT NULL,
  user_id              UUID NOT NULL,
  turn_id              TEXT NOT NULL,
  entity_kind          TEXT NOT NULL,
  entity_data          JSONB NOT NULL,
  confidence           NUMERIC(4,3) NOT NULL DEFAULT 0,
  gate_decision        ap_gate_decision NOT NULL,
  dedupe_action        ap_dedupe_action,
  dedupe_reason        TEXT NOT NULL DEFAULT '',
  dedupe_score         NUMERIC(4,3) NOT NULL DEFAULT 0,
  persisted_row_id     UUID,
  persisted_table      TEXT,
  owner_confirmation   ap_owner_confirmation NOT NULL DEFAULT 'auto',
  error_message        TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ap_audit_tenant ON auto_populate_audit (tenant_id);
CREATE INDEX IF NOT EXISTS idx_ap_audit_turn ON auto_populate_audit (turn_id);
CREATE INDEX IF NOT EXISTS idx_ap_audit_kind ON auto_populate_audit (entity_kind);
CREATE INDEX IF NOT EXISTS idx_ap_audit_created ON auto_populate_audit (created_at DESC);

-- --------------------------------------------------------------------------
-- RLS — enforce on every ap_* table + audit table
-- --------------------------------------------------------------------------

-- Helper: a tenant-scoped policy expression we reuse on every table.
-- Falls back to the platform's `get_current_org_id()` and `is_service_role()`
-- helpers (declared in earlier migrations). Both must already exist.

ALTER TABLE ap_employees       ENABLE ROW LEVEL SECURITY;
ALTER TABLE ap_employees       FORCE ROW LEVEL SECURITY;
ALTER TABLE ap_customers       ENABLE ROW LEVEL SECURITY;
ALTER TABLE ap_customers       FORCE ROW LEVEL SECURITY;
ALTER TABLE ap_products        ENABLE ROW LEVEL SECURITY;
ALTER TABLE ap_products        FORCE ROW LEVEL SECURITY;
ALTER TABLE ap_suppliers       ENABLE ROW LEVEL SECURITY;
ALTER TABLE ap_suppliers       FORCE ROW LEVEL SECURITY;
ALTER TABLE ap_meetings        ENABLE ROW LEVEL SECURITY;
ALTER TABLE ap_meetings        FORCE ROW LEVEL SECURITY;
ALTER TABLE ap_decisions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE ap_decisions       FORCE ROW LEVEL SECURITY;
ALTER TABLE ap_feedback        ENABLE ROW LEVEL SECURITY;
ALTER TABLE ap_feedback        FORCE ROW LEVEL SECURITY;
ALTER TABLE ap_goals           ENABLE ROW LEVEL SECURITY;
ALTER TABLE ap_goals           FORCE ROW LEVEL SECURITY;
ALTER TABLE ap_projects        ENABLE ROW LEVEL SECURITY;
ALTER TABLE ap_projects        FORCE ROW LEVEL SECURITY;
ALTER TABLE ap_risks           ENABLE ROW LEVEL SECURITY;
ALTER TABLE ap_risks           FORCE ROW LEVEL SECURITY;
ALTER TABLE ap_opportunities   ENABLE ROW LEVEL SECURITY;
ALTER TABLE ap_opportunities   FORCE ROW LEVEL SECURITY;
ALTER TABLE auto_populate_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE auto_populate_audit FORCE ROW LEVEL SECURITY;

-- --------------------------------------------------------------------------
-- RLS POLICIES — one block per table. Service role bypasses entirely.
-- --------------------------------------------------------------------------

-- ap_employees
DROP POLICY IF EXISTS ap_employees_select ON ap_employees;
CREATE POLICY ap_employees_select ON ap_employees FOR SELECT
  USING (is_service_role() OR tenant_id = get_current_org_id());
DROP POLICY IF EXISTS ap_employees_insert ON ap_employees;
CREATE POLICY ap_employees_insert ON ap_employees FOR INSERT
  WITH CHECK (is_service_role() OR tenant_id = get_current_org_id());
DROP POLICY IF EXISTS ap_employees_update ON ap_employees;
CREATE POLICY ap_employees_update ON ap_employees FOR UPDATE
  USING (is_service_role() OR tenant_id = get_current_org_id())
  WITH CHECK (is_service_role() OR tenant_id = get_current_org_id());
DROP POLICY IF EXISTS ap_employees_delete ON ap_employees;
CREATE POLICY ap_employees_delete ON ap_employees FOR DELETE
  USING (is_service_role() OR tenant_id = get_current_org_id());

-- ap_customers
DROP POLICY IF EXISTS ap_customers_select ON ap_customers;
CREATE POLICY ap_customers_select ON ap_customers FOR SELECT
  USING (is_service_role() OR tenant_id = get_current_org_id());
DROP POLICY IF EXISTS ap_customers_insert ON ap_customers;
CREATE POLICY ap_customers_insert ON ap_customers FOR INSERT
  WITH CHECK (is_service_role() OR tenant_id = get_current_org_id());
DROP POLICY IF EXISTS ap_customers_update ON ap_customers;
CREATE POLICY ap_customers_update ON ap_customers FOR UPDATE
  USING (is_service_role() OR tenant_id = get_current_org_id())
  WITH CHECK (is_service_role() OR tenant_id = get_current_org_id());
DROP POLICY IF EXISTS ap_customers_delete ON ap_customers;
CREATE POLICY ap_customers_delete ON ap_customers FOR DELETE
  USING (is_service_role() OR tenant_id = get_current_org_id());

-- ap_products
DROP POLICY IF EXISTS ap_products_select ON ap_products;
CREATE POLICY ap_products_select ON ap_products FOR SELECT
  USING (is_service_role() OR tenant_id = get_current_org_id());
DROP POLICY IF EXISTS ap_products_insert ON ap_products;
CREATE POLICY ap_products_insert ON ap_products FOR INSERT
  WITH CHECK (is_service_role() OR tenant_id = get_current_org_id());
DROP POLICY IF EXISTS ap_products_update ON ap_products;
CREATE POLICY ap_products_update ON ap_products FOR UPDATE
  USING (is_service_role() OR tenant_id = get_current_org_id())
  WITH CHECK (is_service_role() OR tenant_id = get_current_org_id());
DROP POLICY IF EXISTS ap_products_delete ON ap_products;
CREATE POLICY ap_products_delete ON ap_products FOR DELETE
  USING (is_service_role() OR tenant_id = get_current_org_id());

-- ap_suppliers
DROP POLICY IF EXISTS ap_suppliers_select ON ap_suppliers;
CREATE POLICY ap_suppliers_select ON ap_suppliers FOR SELECT
  USING (is_service_role() OR tenant_id = get_current_org_id());
DROP POLICY IF EXISTS ap_suppliers_insert ON ap_suppliers;
CREATE POLICY ap_suppliers_insert ON ap_suppliers FOR INSERT
  WITH CHECK (is_service_role() OR tenant_id = get_current_org_id());
DROP POLICY IF EXISTS ap_suppliers_update ON ap_suppliers;
CREATE POLICY ap_suppliers_update ON ap_suppliers FOR UPDATE
  USING (is_service_role() OR tenant_id = get_current_org_id())
  WITH CHECK (is_service_role() OR tenant_id = get_current_org_id());
DROP POLICY IF EXISTS ap_suppliers_delete ON ap_suppliers;
CREATE POLICY ap_suppliers_delete ON ap_suppliers FOR DELETE
  USING (is_service_role() OR tenant_id = get_current_org_id());

-- ap_meetings
DROP POLICY IF EXISTS ap_meetings_select ON ap_meetings;
CREATE POLICY ap_meetings_select ON ap_meetings FOR SELECT
  USING (is_service_role() OR tenant_id = get_current_org_id());
DROP POLICY IF EXISTS ap_meetings_insert ON ap_meetings;
CREATE POLICY ap_meetings_insert ON ap_meetings FOR INSERT
  WITH CHECK (is_service_role() OR tenant_id = get_current_org_id());
DROP POLICY IF EXISTS ap_meetings_update ON ap_meetings;
CREATE POLICY ap_meetings_update ON ap_meetings FOR UPDATE
  USING (is_service_role() OR tenant_id = get_current_org_id())
  WITH CHECK (is_service_role() OR tenant_id = get_current_org_id());
DROP POLICY IF EXISTS ap_meetings_delete ON ap_meetings;
CREATE POLICY ap_meetings_delete ON ap_meetings FOR DELETE
  USING (is_service_role() OR tenant_id = get_current_org_id());

-- ap_decisions
DROP POLICY IF EXISTS ap_decisions_select ON ap_decisions;
CREATE POLICY ap_decisions_select ON ap_decisions FOR SELECT
  USING (is_service_role() OR tenant_id = get_current_org_id());
DROP POLICY IF EXISTS ap_decisions_insert ON ap_decisions;
CREATE POLICY ap_decisions_insert ON ap_decisions FOR INSERT
  WITH CHECK (is_service_role() OR tenant_id = get_current_org_id());
DROP POLICY IF EXISTS ap_decisions_update ON ap_decisions;
CREATE POLICY ap_decisions_update ON ap_decisions FOR UPDATE
  USING (is_service_role() OR tenant_id = get_current_org_id())
  WITH CHECK (is_service_role() OR tenant_id = get_current_org_id());
DROP POLICY IF EXISTS ap_decisions_delete ON ap_decisions;
CREATE POLICY ap_decisions_delete ON ap_decisions FOR DELETE
  USING (is_service_role() OR tenant_id = get_current_org_id());

-- ap_feedback
DROP POLICY IF EXISTS ap_feedback_select ON ap_feedback;
CREATE POLICY ap_feedback_select ON ap_feedback FOR SELECT
  USING (is_service_role() OR tenant_id = get_current_org_id());
DROP POLICY IF EXISTS ap_feedback_insert ON ap_feedback;
CREATE POLICY ap_feedback_insert ON ap_feedback FOR INSERT
  WITH CHECK (is_service_role() OR tenant_id = get_current_org_id());
DROP POLICY IF EXISTS ap_feedback_update ON ap_feedback;
CREATE POLICY ap_feedback_update ON ap_feedback FOR UPDATE
  USING (is_service_role() OR tenant_id = get_current_org_id())
  WITH CHECK (is_service_role() OR tenant_id = get_current_org_id());
DROP POLICY IF EXISTS ap_feedback_delete ON ap_feedback;
CREATE POLICY ap_feedback_delete ON ap_feedback FOR DELETE
  USING (is_service_role() OR tenant_id = get_current_org_id());

-- ap_goals
DROP POLICY IF EXISTS ap_goals_select ON ap_goals;
CREATE POLICY ap_goals_select ON ap_goals FOR SELECT
  USING (is_service_role() OR tenant_id = get_current_org_id());
DROP POLICY IF EXISTS ap_goals_insert ON ap_goals;
CREATE POLICY ap_goals_insert ON ap_goals FOR INSERT
  WITH CHECK (is_service_role() OR tenant_id = get_current_org_id());
DROP POLICY IF EXISTS ap_goals_update ON ap_goals;
CREATE POLICY ap_goals_update ON ap_goals FOR UPDATE
  USING (is_service_role() OR tenant_id = get_current_org_id())
  WITH CHECK (is_service_role() OR tenant_id = get_current_org_id());
DROP POLICY IF EXISTS ap_goals_delete ON ap_goals;
CREATE POLICY ap_goals_delete ON ap_goals FOR DELETE
  USING (is_service_role() OR tenant_id = get_current_org_id());

-- ap_projects
DROP POLICY IF EXISTS ap_projects_select ON ap_projects;
CREATE POLICY ap_projects_select ON ap_projects FOR SELECT
  USING (is_service_role() OR tenant_id = get_current_org_id());
DROP POLICY IF EXISTS ap_projects_insert ON ap_projects;
CREATE POLICY ap_projects_insert ON ap_projects FOR INSERT
  WITH CHECK (is_service_role() OR tenant_id = get_current_org_id());
DROP POLICY IF EXISTS ap_projects_update ON ap_projects;
CREATE POLICY ap_projects_update ON ap_projects FOR UPDATE
  USING (is_service_role() OR tenant_id = get_current_org_id())
  WITH CHECK (is_service_role() OR tenant_id = get_current_org_id());
DROP POLICY IF EXISTS ap_projects_delete ON ap_projects;
CREATE POLICY ap_projects_delete ON ap_projects FOR DELETE
  USING (is_service_role() OR tenant_id = get_current_org_id());

-- ap_risks
DROP POLICY IF EXISTS ap_risks_select ON ap_risks;
CREATE POLICY ap_risks_select ON ap_risks FOR SELECT
  USING (is_service_role() OR tenant_id = get_current_org_id());
DROP POLICY IF EXISTS ap_risks_insert ON ap_risks;
CREATE POLICY ap_risks_insert ON ap_risks FOR INSERT
  WITH CHECK (is_service_role() OR tenant_id = get_current_org_id());
DROP POLICY IF EXISTS ap_risks_update ON ap_risks;
CREATE POLICY ap_risks_update ON ap_risks FOR UPDATE
  USING (is_service_role() OR tenant_id = get_current_org_id())
  WITH CHECK (is_service_role() OR tenant_id = get_current_org_id());
DROP POLICY IF EXISTS ap_risks_delete ON ap_risks;
CREATE POLICY ap_risks_delete ON ap_risks FOR DELETE
  USING (is_service_role() OR tenant_id = get_current_org_id());

-- ap_opportunities
DROP POLICY IF EXISTS ap_opportunities_select ON ap_opportunities;
CREATE POLICY ap_opportunities_select ON ap_opportunities FOR SELECT
  USING (is_service_role() OR tenant_id = get_current_org_id());
DROP POLICY IF EXISTS ap_opportunities_insert ON ap_opportunities;
CREATE POLICY ap_opportunities_insert ON ap_opportunities FOR INSERT
  WITH CHECK (is_service_role() OR tenant_id = get_current_org_id());
DROP POLICY IF EXISTS ap_opportunities_update ON ap_opportunities;
CREATE POLICY ap_opportunities_update ON ap_opportunities FOR UPDATE
  USING (is_service_role() OR tenant_id = get_current_org_id())
  WITH CHECK (is_service_role() OR tenant_id = get_current_org_id());
DROP POLICY IF EXISTS ap_opportunities_delete ON ap_opportunities;
CREATE POLICY ap_opportunities_delete ON ap_opportunities FOR DELETE
  USING (is_service_role() OR tenant_id = get_current_org_id());

-- auto_populate_audit
DROP POLICY IF EXISTS auto_populate_audit_select ON auto_populate_audit;
CREATE POLICY auto_populate_audit_select ON auto_populate_audit FOR SELECT
  USING (is_service_role() OR tenant_id = get_current_org_id());
DROP POLICY IF EXISTS auto_populate_audit_insert ON auto_populate_audit;
CREATE POLICY auto_populate_audit_insert ON auto_populate_audit FOR INSERT
  WITH CHECK (is_service_role() OR tenant_id = get_current_org_id());
DROP POLICY IF EXISTS auto_populate_audit_update ON auto_populate_audit;
CREATE POLICY auto_populate_audit_update ON auto_populate_audit FOR UPDATE
  USING (is_service_role() OR tenant_id = get_current_org_id())
  WITH CHECK (is_service_role() OR tenant_id = get_current_org_id());
-- audit rows are immutable from the owner side; no DELETE policy.
