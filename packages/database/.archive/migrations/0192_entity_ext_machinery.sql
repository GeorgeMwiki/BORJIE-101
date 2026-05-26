-- =============================================================================
-- 0192: entity_ext_machinery — thin extension table for MACHINERY entities.
--
-- Serial number, manufacturer, model, installation date, warranty
-- expiry, last inspection, hours-run. Parent is typically a BUILDING
-- or LAND_PARCEL (the machinery's physical site).
--
-- Tenant-scoped via RLS.
-- =============================================================================

CREATE TABLE IF NOT EXISTS entity_ext_machinery (
  entity_id            TEXT PRIMARY KEY REFERENCES core_entity(id) ON DELETE CASCADE,
  tenant_id            TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  serial_number        TEXT,
  manufacturer         TEXT,
  model                TEXT,
  installation_date    DATE,
  warranty_expires     DATE,
  last_inspection_at   DATE,
  hours_run            INTEGER,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS entity_ext_machinery_tenant_idx
  ON entity_ext_machinery (tenant_id);

CREATE INDEX IF NOT EXISTS entity_ext_machinery_manufacturer_idx
  ON entity_ext_machinery (tenant_id, manufacturer);

CREATE INDEX IF NOT EXISTS entity_ext_machinery_warranty_idx
  ON entity_ext_machinery (tenant_id, warranty_expires)
  WHERE warranty_expires IS NOT NULL;

-- Per-tenant serial number uniqueness.
CREATE UNIQUE INDEX IF NOT EXISTS entity_ext_machinery_serial_uidx
  ON entity_ext_machinery (tenant_id, serial_number)
  WHERE serial_number IS NOT NULL;

-- RLS
ALTER TABLE entity_ext_machinery ENABLE ROW LEVEL SECURITY;
ALTER TABLE entity_ext_machinery FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_select ON entity_ext_machinery;
DROP POLICY IF EXISTS tenant_isolation_modify ON entity_ext_machinery;

CREATE POLICY tenant_isolation_select ON entity_ext_machinery
  FOR SELECT
  TO authenticated
  USING (tenant_id = public.current_app_tenant_id());

CREATE POLICY tenant_isolation_modify ON entity_ext_machinery
  FOR ALL
  TO authenticated
  USING (tenant_id = public.current_app_tenant_id())
  WITH CHECK (tenant_id = public.current_app_tenant_id());

REVOKE ALL ON entity_ext_machinery FROM anon;

COMMENT ON TABLE entity_ext_machinery IS
  'Thin extension for MACHINERY entities. Serial unique per tenant. '
  'Powers maintenance scheduler (last_inspection_at, hours_run, '
  'warranty_expires) and the audit trail for asset depreciation.';
