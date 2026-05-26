-- =============================================================================
-- Migration 0007 — Borjie mining workforce + marketplace extensions
--
-- Five tenant-scoped tables that back the property-domain → mining-domain
-- repository rewrites (waitlist / gamification / conditional-survey /
-- station-master-coverage / maintenance-taxonomy).
--
--   1. worker_incentives             — safety badges, productivity rewards
--   2. equipment_maintenance_taxonomy — per-equipment-kind problem catalog
--   3. offtake_queue                 — buyers waiting for parcels
--   4. site_supervisor_coverage      — who supervises which site/shift
--   5. pre_shift_inspections         — daily pre-shift safety checklist
--
-- All tables are tenant-scoped with RLS enabled.
-- Idempotent (IF NOT EXISTS). Safe to re-run.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. worker_incentives
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS worker_incentives (
  id                  text PRIMARY KEY,
  tenant_id           text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id             text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind                text NOT NULL,
  points              integer NOT NULL DEFAULT 0,
  reason              text,
  metadata            jsonb NOT NULL DEFAULT '{}'::jsonb,
  awarded_at          timestamptz NOT NULL DEFAULT now(),
  awarded_by_user_id  text REFERENCES users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS worker_incentives_tenant_idx
  ON worker_incentives(tenant_id);
CREATE INDEX IF NOT EXISTS worker_incentives_user_idx
  ON worker_incentives(tenant_id, user_id);
CREATE INDEX IF NOT EXISTS worker_incentives_kind_idx
  ON worker_incentives(tenant_id, kind);
CREATE INDEX IF NOT EXISTS worker_incentives_awarded_at_idx
  ON worker_incentives(tenant_id, awarded_at);

-- -----------------------------------------------------------------------------
-- 2. equipment_maintenance_taxonomy
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS equipment_maintenance_taxonomy (
  id                   text PRIMARY KEY,
  tenant_id            text REFERENCES tenants(id) ON DELETE CASCADE,
  equipment_kind       text NOT NULL,
  code                 text NOT NULL,
  name                 text NOT NULL,
  description          text,
  problem_categories   jsonb NOT NULL DEFAULT '[]'::jsonb,
  sla_hours            integer NOT NULL DEFAULT 72,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS equipment_maintenance_taxonomy_tenant_idx
  ON equipment_maintenance_taxonomy(tenant_id);
CREATE INDEX IF NOT EXISTS equipment_maintenance_taxonomy_kind_idx
  ON equipment_maintenance_taxonomy(tenant_id, equipment_kind);
CREATE UNIQUE INDEX IF NOT EXISTS equipment_maintenance_taxonomy_code_idx
  ON equipment_maintenance_taxonomy(tenant_id, equipment_kind, code);

-- -----------------------------------------------------------------------------
-- 3. offtake_queue
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS offtake_queue (
  id                      text PRIMARY KEY,
  tenant_id               text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  buyer_id                text NOT NULL REFERENCES buyers(id) ON DELETE CASCADE,
  mineral                 text NOT NULL,
  requested_quantity_kg   numeric(12,3) NOT NULL,
  max_price_tzs           numeric(18,2),
  status                  text NOT NULL DEFAULT 'waiting',
  priority                integer NOT NULL DEFAULT 100,
  filters                 jsonb NOT NULL DEFAULT '{}'::jsonb,
  matched_parcel_id       text,
  matched_at              timestamptz,
  fulfilled_at            timestamptz,
  expires_at              timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT offtake_queue_status_check
    CHECK (status IN ('waiting','matched','fulfilled','expired','cancelled'))
);

CREATE INDEX IF NOT EXISTS offtake_queue_tenant_idx
  ON offtake_queue(tenant_id);
CREATE INDEX IF NOT EXISTS offtake_queue_buyer_idx
  ON offtake_queue(tenant_id, buyer_id);
CREATE INDEX IF NOT EXISTS offtake_queue_status_idx
  ON offtake_queue(tenant_id, status, priority);
CREATE INDEX IF NOT EXISTS offtake_queue_mineral_idx
  ON offtake_queue(tenant_id, mineral);

-- -----------------------------------------------------------------------------
-- 4. site_supervisor_coverage
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS site_supervisor_coverage (
  id                   text PRIMARY KEY,
  tenant_id            text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  site_id              text NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  supervisor_user_id   text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  shift_kind           text NOT NULL DEFAULT 'day',
  valid_from           timestamptz NOT NULL DEFAULT now(),
  valid_to             timestamptz,
  metadata             jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT site_supervisor_coverage_shift_check
    CHECK (shift_kind IN ('day','night','all'))
);

CREATE INDEX IF NOT EXISTS site_supervisor_coverage_tenant_idx
  ON site_supervisor_coverage(tenant_id);
CREATE INDEX IF NOT EXISTS site_supervisor_coverage_site_idx
  ON site_supervisor_coverage(tenant_id, site_id);
CREATE INDEX IF NOT EXISTS site_supervisor_coverage_supervisor_idx
  ON site_supervisor_coverage(tenant_id, supervisor_user_id);
CREATE INDEX IF NOT EXISTS site_supervisor_coverage_active_idx
  ON site_supervisor_coverage(tenant_id, site_id, shift_kind, valid_to);

-- -----------------------------------------------------------------------------
-- 5. pre_shift_inspections
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS pre_shift_inspections (
  id                   text PRIMARY KEY,
  tenant_id            text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  site_id              text NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  asset_id             text NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  supervisor_user_id   text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  shift_kind           text NOT NULL DEFAULT 'day',
  checklist            jsonb NOT NULL DEFAULT '[]'::jsonb,
  overall_status       text NOT NULL DEFAULT 'pending',
  sign_off_user_id     text REFERENCES users(id) ON DELETE SET NULL,
  sign_off_at          timestamptz,
  notes                text,
  evidence_ids         text[] NOT NULL DEFAULT ARRAY[]::text[],
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pre_shift_inspections_status_check
    CHECK (overall_status IN ('pending','passed','failed','sign_off_pending')),
  CONSTRAINT pre_shift_inspections_shift_check
    CHECK (shift_kind IN ('day','night'))
);

CREATE INDEX IF NOT EXISTS pre_shift_inspections_tenant_idx
  ON pre_shift_inspections(tenant_id);
CREATE INDEX IF NOT EXISTS pre_shift_inspections_site_idx
  ON pre_shift_inspections(tenant_id, site_id);
CREATE INDEX IF NOT EXISTS pre_shift_inspections_asset_idx
  ON pre_shift_inspections(tenant_id, asset_id);
CREATE INDEX IF NOT EXISTS pre_shift_inspections_status_idx
  ON pre_shift_inspections(tenant_id, overall_status);

-- -----------------------------------------------------------------------------
-- 6. RLS — tenant_isolation policy on every new tenant-scoped table
-- -----------------------------------------------------------------------------

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'worker_incentives',
    'offtake_queue',
    'site_supervisor_coverage',
    'pre_shift_inspections'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format(
      'DROP POLICY IF EXISTS tenant_isolation ON %I;', t
    );
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I '
      'USING (tenant_id = current_setting(''app.tenant_id'', true));',
      t
    );
  END LOOP;
END$$;

-- equipment_maintenance_taxonomy is platform-shared (tenant_id NULL rows are
-- visible to all tenants); RLS policy must allow both shapes.
ALTER TABLE equipment_maintenance_taxonomy ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON equipment_maintenance_taxonomy;
CREATE POLICY tenant_isolation ON equipment_maintenance_taxonomy
  USING (
    tenant_id IS NULL
    OR tenant_id = current_setting('app.tenant_id', true)
  );

COMMIT;
