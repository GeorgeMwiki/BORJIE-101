-- =============================================================================
-- 0189: entity_ext_land — thin extension table for LAND_PARCEL / PLOT /
--       BARELAND / WAREHOUSE / GODOWN entities.
--
-- One row per land parcel, FK'd by entity_id to core_entity. Carries
-- the surveyed / titled attributes (plot number, hectares, fractional
-- area for sub-parcels, zoning, land-use, title-deed ref).
--
-- `in_railway_reserve` is a generic flag for any zoning-conflict
-- scenario (named after the Tanzania Railways pilot use case but
-- usable for power lines, port reserves, conservation areas, etc.).
--
-- Tenant-scoped via RLS (mirror of core_entity policy).
-- =============================================================================

CREATE TABLE IF NOT EXISTS entity_ext_land (
  entity_id           TEXT PRIMARY KEY REFERENCES core_entity(id) ON DELETE CASCADE,
  tenant_id           TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  plot_number         TEXT,
  hectares            NUMERIC(12, 4),
  /**
   * Fractional area — for sub-parcels, what fraction of the parent
   * does this child cover. 0.5 = half, 0.25 = quarter. NULL for
   * top-level parcels.
   */
  fractional_area     NUMERIC(6, 4),
  /**
   * Generic zoning-conflict flag. Originally created for Tanzania
   * Railways reserve land but used for any scenario where the parcel
   * sits inside a protected reserve / utility easement / conservation
   * area. Application code checks this at lease / sale / development
   * proposal time.
   */
  in_railway_reserve  BOOLEAN NOT NULL DEFAULT FALSE,
  zoning              TEXT,
  /** residential / commercial / industrial / mixed / undeveloped */
  land_use            TEXT,
  title_deed_ref      TEXT,
  surveyed_at         DATE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS entity_ext_land_tenant_idx
  ON entity_ext_land (tenant_id);

CREATE INDEX IF NOT EXISTS entity_ext_land_zoning_idx
  ON entity_ext_land (tenant_id, zoning);

CREATE INDEX IF NOT EXISTS entity_ext_land_railway_reserve_idx
  ON entity_ext_land (tenant_id)
  WHERE in_railway_reserve = TRUE;

CREATE INDEX IF NOT EXISTS entity_ext_land_plot_number_idx
  ON entity_ext_land (tenant_id, plot_number)
  WHERE plot_number IS NOT NULL;

-- RLS
ALTER TABLE entity_ext_land ENABLE ROW LEVEL SECURITY;
ALTER TABLE entity_ext_land FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_select ON entity_ext_land;
DROP POLICY IF EXISTS tenant_isolation_modify ON entity_ext_land;

CREATE POLICY tenant_isolation_select ON entity_ext_land
  FOR SELECT
  TO authenticated
  USING (tenant_id = public.current_app_tenant_id());

CREATE POLICY tenant_isolation_modify ON entity_ext_land
  FOR ALL
  TO authenticated
  USING (tenant_id = public.current_app_tenant_id())
  WITH CHECK (tenant_id = public.current_app_tenant_id());

REVOKE ALL ON entity_ext_land FROM anon;

COMMENT ON TABLE entity_ext_land IS
  'Thin extension for LAND_PARCEL / PLOT / BARELAND / WAREHOUSE / GODOWN. '
  'FK by entity_id to core_entity. Carries surveyed attributes (hectares, '
  'fractional_area for sub-parcels, plot_number, title_deed_ref, '
  'in_railway_reserve, zoning, land_use).';

COMMENT ON COLUMN entity_ext_land.fractional_area IS
  'For sub-parcels: portion of the parent parcel covered by this child. '
  '0.5 = half. The sum of all live children should equal 1.0 — enforced '
  'at application level via the repository, not via a check constraint '
  '(which would block transient mid-subdivision states).';
