-- =============================================================================
-- 0190: entity_ext_building — thin extension table for BUILDING / HOTEL /
--       (discriminator-flavoured) WAREHOUSE / GODOWN entities.
--
-- One row per BUILDING-type entity. Stores the structural attributes
-- (floors, square_meters, year_built, condition_rating). Sub-units
-- (rooms, suites, retail bays) are SEPARATE core_entity rows of type
-- SUB_UNIT with parent_entity_id pointing to this BUILDING.
--
-- Tenant-scoped via RLS.
-- =============================================================================

CREATE TABLE IF NOT EXISTS entity_ext_building (
  entity_id            TEXT PRIMARY KEY REFERENCES core_entity(id) ON DELETE CASCADE,
  tenant_id            TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  /**
   * Coarse building type — warehouse / godown / hotel / office / mixed /
   * residential. Distinct from core_entity.discriminator: this field
   * is the structural type (drives valuation models, depreciation
   * schedules); the discriminator is the marketing-facing label.
   */
  building_type        TEXT NOT NULL,
  floors               SMALLINT,
  square_meters        NUMERIC(12, 2),
  year_built           SMALLINT,
  /** 1 (very poor) — 5 (excellent). Drives inspection cadence. */
  condition_rating     SMALLINT,
  last_inspection_at   DATE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS entity_ext_building_tenant_idx
  ON entity_ext_building (tenant_id);

CREATE INDEX IF NOT EXISTS entity_ext_building_type_idx
  ON entity_ext_building (tenant_id, building_type);

CREATE INDEX IF NOT EXISTS entity_ext_building_year_idx
  ON entity_ext_building (tenant_id, year_built);

-- Optional CHECK on condition_rating range. Idempotent via DO block.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'entity_ext_building_condition_range'
  ) THEN
    EXECUTE 'ALTER TABLE entity_ext_building '
            'ADD CONSTRAINT entity_ext_building_condition_range '
            'CHECK (condition_rating IS NULL OR (condition_rating BETWEEN 1 AND 5))';
  END IF;
END
$$;

-- RLS
ALTER TABLE entity_ext_building ENABLE ROW LEVEL SECURITY;
ALTER TABLE entity_ext_building FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_select ON entity_ext_building;
DROP POLICY IF EXISTS tenant_isolation_modify ON entity_ext_building;

CREATE POLICY tenant_isolation_select ON entity_ext_building
  FOR SELECT
  TO authenticated
  USING (tenant_id = public.current_app_tenant_id());

CREATE POLICY tenant_isolation_modify ON entity_ext_building
  FOR ALL
  TO authenticated
  USING (tenant_id = public.current_app_tenant_id())
  WITH CHECK (tenant_id = public.current_app_tenant_id());

REVOKE ALL ON entity_ext_building FROM anon;

COMMENT ON TABLE entity_ext_building IS
  'Thin extension for BUILDING-type core_entity rows. building_type is the '
  'structural classification (warehouse/godown/hotel/office/mixed/residential). '
  'Sub-units are SEPARATE core_entity rows with parent_entity_id pointing here.';
