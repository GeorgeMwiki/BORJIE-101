-- =============================================================================
-- 0191: entity_ext_vehicle — thin extension table for VEHICLE / LOCOMOTIVE
--       core_entity rows.
--
-- VIN, license plate, make/model/year, fuel type, odometer, status,
-- last_service_at. Status is free-form TEXT for forward-compat with
-- tenant-specific lifecycle states.
--
-- Tenant-scoped via RLS.
-- =============================================================================

CREATE TABLE IF NOT EXISTS entity_ext_vehicle (
  entity_id           TEXT PRIMARY KEY REFERENCES core_entity(id) ON DELETE CASCADE,
  tenant_id           TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  vin                 TEXT,
  license_plate       TEXT,
  make                TEXT,
  model               TEXT,
  year_manufactured   SMALLINT,
  fuel_type           TEXT,
  odometer_km         INTEGER,
  /** active / maintenance / retired / sold / impounded — free-form TEXT. */
  status              TEXT NOT NULL DEFAULT 'active',
  last_service_at     DATE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS entity_ext_vehicle_tenant_idx
  ON entity_ext_vehicle (tenant_id);

CREATE INDEX IF NOT EXISTS entity_ext_vehicle_status_idx
  ON entity_ext_vehicle (tenant_id, status);

CREATE INDEX IF NOT EXISTS entity_ext_vehicle_plate_idx
  ON entity_ext_vehicle (tenant_id, license_plate)
  WHERE license_plate IS NOT NULL;

CREATE INDEX IF NOT EXISTS entity_ext_vehicle_vin_idx
  ON entity_ext_vehicle (tenant_id, vin)
  WHERE vin IS NOT NULL;

-- Per-tenant uniqueness for VIN + license plate. NULL allowed
-- (vehicles without plates yet, or retired locomotives without VINs).
CREATE UNIQUE INDEX IF NOT EXISTS entity_ext_vehicle_vin_uidx
  ON entity_ext_vehicle (tenant_id, vin)
  WHERE vin IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS entity_ext_vehicle_plate_uidx
  ON entity_ext_vehicle (tenant_id, license_plate)
  WHERE license_plate IS NOT NULL;

-- RLS
ALTER TABLE entity_ext_vehicle ENABLE ROW LEVEL SECURITY;
ALTER TABLE entity_ext_vehicle FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_select ON entity_ext_vehicle;
DROP POLICY IF EXISTS tenant_isolation_modify ON entity_ext_vehicle;

CREATE POLICY tenant_isolation_select ON entity_ext_vehicle
  FOR SELECT
  TO authenticated
  USING (tenant_id = public.current_app_tenant_id());

CREATE POLICY tenant_isolation_modify ON entity_ext_vehicle
  FOR ALL
  TO authenticated
  USING (tenant_id = public.current_app_tenant_id())
  WITH CHECK (tenant_id = public.current_app_tenant_id());

REVOKE ALL ON entity_ext_vehicle FROM anon;

COMMENT ON TABLE entity_ext_vehicle IS
  'Thin extension for VEHICLE / LOCOMOTIVE entities. VIN and license_plate '
  'unique per tenant when set. Status free-form to admit tenant lifecycles.';
