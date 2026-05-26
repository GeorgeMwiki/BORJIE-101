-- ============================================================================
-- BORJIE — Maintenance Requests, Dispatch Events, Completion Proofs,
-- Dual Sign-offs, Vendor Assignments, Assets, Vendor Scorecards, Scheduling
--
-- These tables existed as Drizzle schemas in packages/database/src/schemas but
-- had no matching SQL migration. This migration creates them all with RLS.
-- ============================================================================

-- Enums --------------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE maintenance_request_status AS ENUM (
    'submitted', 'triaged', 'classified', 'dispatched', 'in_progress',
    'awaiting_parts', 'completed', 'verified', 'rejected', 'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE dispatch_status AS ENUM (
    'pending', 'assigned', 'acknowledged', 'en_route', 'on_site',
    'completed', 'cancelled', 'failed'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE asset_status AS ENUM (
    'active', 'maintenance', 'retired', 'disposed', 'lost'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE asset_condition AS ENUM (
    'excellent', 'good', 'fair', 'poor', 'critical'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Maintenance Requests -----------------------------------------------------

CREATE TABLE IF NOT EXISTS maintenance_requests (
  id                    TEXT PRIMARY KEY,
  tenant_id             TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  property_id           TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  unit_id               TEXT REFERENCES units(id) ON DELETE SET NULL,
  customer_id           TEXT REFERENCES customers(id) ON DELETE SET NULL,
  work_order_id         TEXT REFERENCES work_orders(id) ON DELETE SET NULL,
  request_number        TEXT NOT NULL,
  title                 TEXT NOT NULL,
  description           TEXT,
  category              TEXT,
  priority              TEXT DEFAULT 'medium',
  status                maintenance_request_status NOT NULL DEFAULT 'submitted',
  source                TEXT DEFAULT 'customer_request',
  photos                JSONB DEFAULT '[]'::jsonb,
  location              TEXT,
  preferred_window      JSONB,
  ai_suggested_priority TEXT,
  ai_suggested_category TEXT,
  ai_confidence_score   NUMERIC(5, 2),
  ai_notes              TEXT,
  dispatched_at         TIMESTAMPTZ,
  completed_at          TIMESTAMPTZ,
  verified_at           TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by            TEXT,
  updated_by            TEXT,
  deleted_at            TIMESTAMPTZ,
  deleted_by            TEXT
);
CREATE INDEX IF NOT EXISTS mr_tenant_idx ON maintenance_requests(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS mr_number_tenant_idx ON maintenance_requests(tenant_id, request_number);
CREATE INDEX IF NOT EXISTS mr_property_idx ON maintenance_requests(property_id);
CREATE INDEX IF NOT EXISTS mr_unit_idx ON maintenance_requests(unit_id);
CREATE INDEX IF NOT EXISTS mr_status_idx ON maintenance_requests(tenant_id, status);

-- Dispatch Events ----------------------------------------------------------

CREATE TABLE IF NOT EXISTS dispatch_events (
  id                 TEXT PRIMARY KEY,
  tenant_id          TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  work_order_id      TEXT NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  vendor_id          TEXT REFERENCES vendors(id) ON DELETE SET NULL,
  dispatched_by      TEXT,
  status             dispatch_status NOT NULL DEFAULT 'pending',
  dispatched_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  acknowledged_at    TIMESTAMPTZ,
  en_route_at        TIMESTAMPTZ,
  on_site_at         TIMESTAMPTZ,
  completed_at       TIMESTAMPTZ,
  cancelled_at       TIMESTAMPTZ,
  reason             TEXT,
  eta_minutes        INTEGER,
  location           JSONB,
  metadata           JSONB DEFAULT '{}'::jsonb,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS de_tenant_idx ON dispatch_events(tenant_id);
CREATE INDEX IF NOT EXISTS de_work_order_idx ON dispatch_events(work_order_id);
CREATE INDEX IF NOT EXISTS de_vendor_idx ON dispatch_events(vendor_id);
CREATE INDEX IF NOT EXISTS de_status_idx ON dispatch_events(tenant_id, status);

-- Completion Proofs --------------------------------------------------------

CREATE TABLE IF NOT EXISTS completion_proofs (
  id                      TEXT PRIMARY KEY,
  tenant_id               TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  work_order_id           TEXT NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  vendor_id               TEXT REFERENCES vendors(id) ON DELETE SET NULL,
  submitted_by            TEXT,
  before_photos           JSONB DEFAULT '[]'::jsonb,
  after_photos            JSONB DEFAULT '[]'::jsonb,
  signature               JSONB,
  parts_used              JSONB DEFAULT '[]'::jsonb,
  labor_hours             NUMERIC(6, 2),
  cost_actual_minor_units INTEGER,
  notes                   TEXT,
  verified_by             TEXT,
  verified_at             TIMESTAMPTZ,
  rejected_reason         TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cp_tenant_idx ON completion_proofs(tenant_id);
CREATE INDEX IF NOT EXISTS cp_work_order_idx ON completion_proofs(work_order_id);
CREATE INDEX IF NOT EXISTS cp_verified_idx ON completion_proofs(verified_at);

-- Dual Sign-offs -----------------------------------------------------------

CREATE TABLE IF NOT EXISTS dual_signoffs (
  id                  TEXT PRIMARY KEY,
  tenant_id           TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entity_kind         TEXT NOT NULL,
  entity_id           TEXT NOT NULL,
  technician_user_id  TEXT,
  technician_signed_at TIMESTAMPTZ,
  customer_user_id    TEXT,
  customer_signed_at  TIMESTAMPTZ,
  status              TEXT NOT NULL DEFAULT 'pending',
  expires_at          TIMESTAMPTZ,
  metadata            JSONB DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ds_tenant_idx ON dual_signoffs(tenant_id);
CREATE INDEX IF NOT EXISTS ds_entity_idx ON dual_signoffs(entity_kind, entity_id);

-- Vendor Assignments -------------------------------------------------------

CREATE TABLE IF NOT EXISTS vendor_assignments (
  id                      TEXT PRIMARY KEY,
  tenant_id               TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  vendor_id               TEXT NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  property_id             TEXT REFERENCES properties(id) ON DELETE SET NULL,
  category                TEXT,
  exclusive               BOOLEAN NOT NULL DEFAULT FALSE,
  priority                INTEGER NOT NULL DEFAULT 3,
  starts_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  ends_at                 TIMESTAMPTZ,
  response_sla_minutes    INTEGER,
  resolution_sla_minutes  INTEGER,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS va_tenant_idx ON vendor_assignments(tenant_id);
CREATE INDEX IF NOT EXISTS va_vendor_idx ON vendor_assignments(vendor_id);
CREATE INDEX IF NOT EXISTS va_property_idx ON vendor_assignments(property_id);
CREATE INDEX IF NOT EXISTS va_category_idx ON vendor_assignments(tenant_id, category);

-- Assets -------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS assets (
  id                       TEXT PRIMARY KEY,
  tenant_id                TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  property_id              TEXT REFERENCES properties(id) ON DELETE SET NULL,
  unit_id                  TEXT REFERENCES units(id) ON DELETE SET NULL,
  asset_code               TEXT NOT NULL,
  name                     TEXT NOT NULL,
  category                 TEXT,
  serial_number            TEXT,
  manufacturer             TEXT,
  model                    TEXT,
  installed_at             TIMESTAMPTZ,
  warranty_ends_at         TIMESTAMPTZ,
  next_maintenance_due     TIMESTAMPTZ,
  status                   asset_status NOT NULL DEFAULT 'active',
  condition                asset_condition NOT NULL DEFAULT 'good',
  purchase_price_minor     INTEGER,
  current_value_minor      INTEGER,
  metadata                 JSONB DEFAULT '{}'::jsonb,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at               TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS assets_tenant_idx ON assets(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS assets_asset_code_tenant_idx ON assets(tenant_id, asset_code);
CREATE INDEX IF NOT EXISTS assets_property_idx ON assets(property_id);
CREATE INDEX IF NOT EXISTS assets_unit_idx ON assets(unit_id);
CREATE INDEX IF NOT EXISTS assets_category_idx ON assets(category);
CREATE INDEX IF NOT EXISTS assets_status_idx ON assets(status);
CREATE INDEX IF NOT EXISTS assets_condition_idx ON assets(condition);
CREATE INDEX IF NOT EXISTS assets_next_maintenance_due_idx ON assets(next_maintenance_due);

-- Vendor Scorecards --------------------------------------------------------
-- NOTE: 0001b_add_missing_entities.sql already creates a `vendor_scorecards`
-- table with a different column shape (period_month/period_year, quality_score,
-- etc.). Rather than duplicate-create and conflict, we extend the existing
-- table with the operational columns this migration needs. All additions are
-- `ADD COLUMN IF NOT EXISTS` so the migration is idempotent and safe to run
-- against environments that used either schema.

CREATE TABLE IF NOT EXISTS vendor_scorecards (
  id         TEXT PRIMARY KEY,
  tenant_id  TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  vendor_id  TEXT NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE vendor_scorecards
  ADD COLUMN IF NOT EXISTS period_start              TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS period_end                TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS total_jobs                INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS completed_jobs            INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cancelled_jobs            INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS avg_rating                NUMERIC(3, 2),
  ADD COLUMN IF NOT EXISTS rating_count              INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS first_time_fix_rate       NUMERIC(5, 2),
  ADD COLUMN IF NOT EXISTS on_time_arrival_rate      NUMERIC(5, 2),
  ADD COLUMN IF NOT EXISTS avg_response_time_minutes INTEGER,
  ADD COLUMN IF NOT EXISTS sla_compliance_rate       NUMERIC(5, 2),
  ADD COLUMN IF NOT EXISTS avg_job_cost              INTEGER,
  ADD COLUMN IF NOT EXISTS cost_variance             NUMERIC(5, 2),
  ADD COLUMN IF NOT EXISTS communication_score       NUMERIC(3, 2),
  ADD COLUMN IF NOT EXISTS complaint_count           INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS resolved_complaints       INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS trend                     TEXT,
  ADD COLUMN IF NOT EXISTS recommendations           JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS is_latest                 BOOLEAN NOT NULL DEFAULT TRUE;

CREATE INDEX IF NOT EXISTS vs_tenant_idx ON vendor_scorecards(tenant_id);
CREATE INDEX IF NOT EXISTS vs_vendor_idx ON vendor_scorecards(vendor_id);
CREATE INDEX IF NOT EXISTS vs_period_idx ON vendor_scorecards(period_start, period_end);
CREATE INDEX IF NOT EXISTS vs_latest_idx ON vendor_scorecards(vendor_id, is_latest);
CREATE INDEX IF NOT EXISTS vs_overall_score_idx ON vendor_scorecards(overall_score);

-- Scheduling ---------------------------------------------------------------

CREATE TABLE IF NOT EXISTS scheduling_events (
  id              TEXT PRIMARY KEY,
  tenant_id       TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  property_id     TEXT REFERENCES properties(id) ON DELETE SET NULL,
  unit_id         TEXT REFERENCES units(id) ON DELETE SET NULL,
  customer_id     TEXT REFERENCES customers(id) ON DELETE SET NULL,
  kind            TEXT NOT NULL,
  title           TEXT NOT NULL,
  description     TEXT,
  scheduled_for   TIMESTAMPTZ NOT NULL,
  duration_minutes INTEGER,
  owner_user_id   TEXT,
  assignee_ids    TEXT[] DEFAULT ARRAY[]::TEXT[],
  status          TEXT NOT NULL DEFAULT 'scheduled',
  cancelled_reason TEXT,
  completed_at    TIMESTAMPTZ,
  reminder_sent   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS se_tenant_idx ON scheduling_events(tenant_id);
CREATE INDEX IF NOT EXISTS se_property_idx ON scheduling_events(property_id);
CREATE INDEX IF NOT EXISTS se_scheduled_idx ON scheduling_events(scheduled_for);
CREATE INDEX IF NOT EXISTS se_status_idx ON scheduling_events(tenant_id, status);

-- Row Level Security -------------------------------------------------------

ALTER TABLE maintenance_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE dispatch_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE completion_proofs ENABLE ROW LEVEL SECURITY;
ALTER TABLE dual_signoffs ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor_scorecards ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduling_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY mr_tenant_isolation ON maintenance_requests
  FOR ALL USING (tenant_id = current_setting('app.current_tenant_id', TRUE)::TEXT);
CREATE POLICY de_tenant_isolation ON dispatch_events
  FOR ALL USING (tenant_id = current_setting('app.current_tenant_id', TRUE)::TEXT);
CREATE POLICY cp_tenant_isolation ON completion_proofs
  FOR ALL USING (tenant_id = current_setting('app.current_tenant_id', TRUE)::TEXT);
CREATE POLICY ds_tenant_isolation ON dual_signoffs
  FOR ALL USING (tenant_id = current_setting('app.current_tenant_id', TRUE)::TEXT);
CREATE POLICY va_tenant_isolation ON vendor_assignments
  FOR ALL USING (tenant_id = current_setting('app.current_tenant_id', TRUE)::TEXT);
CREATE POLICY assets_tenant_isolation ON assets
  FOR ALL USING (tenant_id = current_setting('app.current_tenant_id', TRUE)::TEXT);
CREATE POLICY vs_tenant_isolation ON vendor_scorecards
  FOR ALL USING (tenant_id = current_setting('app.current_tenant_id', TRUE)::TEXT);
CREATE POLICY se_tenant_isolation ON scheduling_events
  FOR ALL USING (tenant_id = current_setting('app.current_tenant_id', TRUE)::TEXT);
