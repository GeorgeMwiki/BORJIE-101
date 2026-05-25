-- ============================================================================
-- BORJIE — FAR Asset Components & Condition Monitoring (NEW 16)
--
-- Component-level tracking with scheduled condition checks.
-- ============================================================================

-- Enums ----------------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE asset_component_status AS ENUM (
    'active', 'monitoring', 'needs_repair', 'decommissioned'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE asset_component_condition AS ENUM (
    'excellent', 'good', 'fair', 'poor', 'critical'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE far_assignment_status AS ENUM (
    'active', 'paused', 'cancelled', 'completed'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE far_check_frequency AS ENUM (
    'weekly', 'monthly', 'quarterly', 'biannual', 'annual', 'ad_hoc'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE condition_check_outcome AS ENUM (
    'pass', 'warning', 'fail', 'skipped'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- asset_components -----------------------------------------------------------

CREATE TABLE IF NOT EXISTS asset_components (
  id                         TEXT PRIMARY KEY,
  tenant_id                  TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  property_id                TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  unit_id                    TEXT REFERENCES units(id) ON DELETE SET NULL,

  code                       TEXT NOT NULL,
  name                       TEXT NOT NULL,
  category                   TEXT,
  manufacturer               TEXT,
  model_number               TEXT,
  serial_number              TEXT,
  installed_at               TIMESTAMPTZ,
  expected_lifespan_months   INTEGER,

  status                     asset_component_status NOT NULL DEFAULT 'active',
  current_condition          asset_component_condition NOT NULL DEFAULT 'good',

  metadata                   JSONB DEFAULT '{}'::jsonb,

  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by                 TEXT,
  updated_by                 TEXT
);

CREATE INDEX IF NOT EXISTS asset_components_tenant_idx   ON asset_components(tenant_id);
CREATE INDEX IF NOT EXISTS asset_components_property_idx ON asset_components(property_id);
CREATE INDEX IF NOT EXISTS asset_components_unit_idx     ON asset_components(unit_id);
CREATE INDEX IF NOT EXISTS asset_components_status_idx   ON asset_components(status);
CREATE INDEX IF NOT EXISTS asset_components_code_idx     ON asset_components(tenant_id, code);

-- far_assignments ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS far_assignments (
  id                  TEXT PRIMARY KEY,
  tenant_id           TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  component_id        TEXT NOT NULL REFERENCES asset_components(id) ON DELETE CASCADE,

  assigned_to         TEXT REFERENCES users(id) ON DELETE SET NULL,
  frequency           far_check_frequency NOT NULL,
  status              far_assignment_status NOT NULL DEFAULT 'active',

  trigger_rules       JSONB DEFAULT '{}'::jsonb,
  first_check_due_at  TIMESTAMPTZ,
  next_check_due_at   TIMESTAMPTZ,
  last_checked_at     TIMESTAMPTZ,

  notify_recipients   JSONB DEFAULT '[]'::jsonb,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by          TEXT,
  updated_by          TEXT
);

CREATE INDEX IF NOT EXISTS far_assignments_tenant_idx    ON far_assignments(tenant_id);
CREATE INDEX IF NOT EXISTS far_assignments_component_idx ON far_assignments(component_id);
CREATE INDEX IF NOT EXISTS far_assignments_status_idx    ON far_assignments(status);
CREATE INDEX IF NOT EXISTS far_assignments_next_check_idx ON far_assignments(next_check_due_at);

-- condition_check_events -----------------------------------------------------

CREATE TABLE IF NOT EXISTS condition_check_events (
  id                  TEXT PRIMARY KEY,
  tenant_id           TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  far_assignment_id   TEXT NOT NULL REFERENCES far_assignments(id) ON DELETE CASCADE,
  component_id        TEXT NOT NULL REFERENCES asset_components(id) ON DELETE CASCADE,

  performed_by        TEXT REFERENCES users(id) ON DELETE SET NULL,
  due_at              TIMESTAMPTZ,
  performed_at        TIMESTAMPTZ,

  outcome             condition_check_outcome NOT NULL DEFAULT 'skipped',
  condition_after     asset_component_condition,
  notes               TEXT,
  photos              JSONB DEFAULT '[]'::jsonb,
  measurements        JSONB DEFAULT '{}'::jsonb,
  notifications_log   JSONB DEFAULT '[]'::jsonb,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS condition_check_events_tenant_idx     ON condition_check_events(tenant_id);
CREATE INDEX IF NOT EXISTS condition_check_events_assignment_idx ON condition_check_events(far_assignment_id);
CREATE INDEX IF NOT EXISTS condition_check_events_component_idx  ON condition_check_events(component_id);
CREATE INDEX IF NOT EXISTS condition_check_events_due_at_idx     ON condition_check_events(due_at);
CREATE INDEX IF NOT EXISTS condition_check_events_outcome_idx    ON condition_check_events(outcome);

-- Row-level security ---------------------------------------------------------

ALTER TABLE asset_components      ENABLE ROW LEVEL SECURITY;
ALTER TABLE far_assignments       ENABLE ROW LEVEL SECURITY;
ALTER TABLE condition_check_events ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY asset_components_tenant_isolation ON asset_components
    USING (tenant_id = current_setting('app.current_tenant_id', TRUE));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY far_assignments_tenant_isolation ON far_assignments
    USING (tenant_id = current_setting('app.current_tenant_id', TRUE));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY condition_check_events_tenant_isolation ON condition_check_events
    USING (tenant_id = current_setting('app.current_tenant_id', TRUE));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
