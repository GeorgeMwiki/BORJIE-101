-- =============================================================================
-- 0193: entity_ext_it_asset — thin extension table for IT_ASSET entities.
--
-- Asset tag, device kind (laptop / phone / server / network), make /
-- model, purchase date, status, and the linkage to a PERSON entity
-- via `assigned_to_entity_id`. The latter is itself a core_entity FK.
--
-- Tenant-scoped via RLS.
-- =============================================================================

CREATE TABLE IF NOT EXISTS entity_ext_it_asset (
  entity_id              TEXT PRIMARY KEY REFERENCES core_entity(id) ON DELETE CASCADE,
  tenant_id              TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  asset_tag              TEXT,
  /** laptop / phone / server / network_device / tablet / accessory */
  device_kind            TEXT,
  manufacturer           TEXT,
  model                  TEXT,
  purchase_date          DATE,
  /**
   * FK to core_entity(id) — but only PERSON entities should occupy
   * this slot. The repository enforces that at write time; DB-level
   * we just ensure the target exists in core_entity.
   */
  assigned_to_entity_id  TEXT REFERENCES core_entity(id) ON DELETE SET NULL,
  /** active / retired / in_repair / lost / stolen / awaiting_provisioning */
  status                 TEXT NOT NULL DEFAULT 'active',
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS entity_ext_it_asset_tenant_idx
  ON entity_ext_it_asset (tenant_id);

CREATE INDEX IF NOT EXISTS entity_ext_it_asset_assigned_idx
  ON entity_ext_it_asset (assigned_to_entity_id)
  WHERE assigned_to_entity_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS entity_ext_it_asset_status_idx
  ON entity_ext_it_asset (tenant_id, status);

CREATE INDEX IF NOT EXISTS entity_ext_it_asset_kind_idx
  ON entity_ext_it_asset (tenant_id, device_kind);

CREATE UNIQUE INDEX IF NOT EXISTS entity_ext_it_asset_tag_uidx
  ON entity_ext_it_asset (tenant_id, asset_tag)
  WHERE asset_tag IS NOT NULL;

-- RLS
ALTER TABLE entity_ext_it_asset ENABLE ROW LEVEL SECURITY;
ALTER TABLE entity_ext_it_asset FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_select ON entity_ext_it_asset;
DROP POLICY IF EXISTS tenant_isolation_modify ON entity_ext_it_asset;

CREATE POLICY tenant_isolation_select ON entity_ext_it_asset
  FOR SELECT
  TO authenticated
  USING (tenant_id = public.current_app_tenant_id());

CREATE POLICY tenant_isolation_modify ON entity_ext_it_asset
  FOR ALL
  TO authenticated
  USING (tenant_id = public.current_app_tenant_id())
  WITH CHECK (tenant_id = public.current_app_tenant_id());

REVOKE ALL ON entity_ext_it_asset FROM anon;

COMMENT ON TABLE entity_ext_it_asset IS
  'Thin extension for IT_ASSET entities. assigned_to_entity_id is a FK '
  'to core_entity (typically a PERSON row). ON DELETE SET NULL so '
  'reassigning at PERSON termination keeps the asset row intact.';

COMMENT ON COLUMN entity_ext_it_asset.assigned_to_entity_id IS
  'FK to core_entity(id) — should be a PERSON entity. Repository '
  'enforces type=PERSON; DB layer just ensures existence.';
