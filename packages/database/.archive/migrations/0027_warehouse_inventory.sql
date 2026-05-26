-- =============================================================================
-- 0027: Warehouse inventory — Wave 8 gap closure (S7)
-- =============================================================================
-- Customer-research directive: "Tracking appliances installed or changed...
-- literally knowing what's in our warehouses, whether it is broken or it's
-- functioning or whatever, it was changed, it was bought, it's new."
--
-- asset_components tracks items INSTALLED in units. This migration adds the
-- complementary warehouse_items + warehouse_movements tables for items that
-- are NOT yet installed (stock, in-transit, broken, decommissioned).
--
-- Idempotent via CREATE TABLE IF NOT EXISTS.
-- =============================================================================

CREATE TABLE IF NOT EXISTS warehouse_items (
  id                TEXT PRIMARY KEY,
  tenant_id         TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sku               TEXT NOT NULL,                    -- org-defined SKU
  name              TEXT NOT NULL,
  category          TEXT NOT NULL,                    -- plumbing/electrical/hvac/appliance/finish/structural
  description       TEXT,
  unit_of_measure   TEXT NOT NULL DEFAULT 'each',     -- each, meter, kg, litre
  quantity          INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  condition         TEXT NOT NULL DEFAULT 'new'
                    CHECK (condition IN ('new','functioning','broken','in_transit','decommissioned','reserved')),
  warehouse_location TEXT,                             -- free text: "HQ warehouse / shelf B-12"
  cost_minor_units  BIGINT,                            -- unit acquisition cost in minor units
  currency          TEXT,                              -- ISO 4217
  supplier_name     TEXT,
  purchase_order_ref TEXT,
  notes             TEXT,
  metadata          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by        TEXT,
  updated_by        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at        TIMESTAMPTZ,
  UNIQUE (tenant_id, sku)
);

CREATE INDEX IF NOT EXISTS idx_warehouse_items_tenant ON warehouse_items(tenant_id);
CREATE INDEX IF NOT EXISTS idx_warehouse_items_category ON warehouse_items(tenant_id, category);
CREATE INDEX IF NOT EXISTS idx_warehouse_items_condition ON warehouse_items(tenant_id, condition)
  WHERE deleted_at IS NULL;

-- Append-only ledger of stock movements. Never updated — every change is a
-- new row so the audit trail is complete.
CREATE TABLE IF NOT EXISTS warehouse_movements (
  id                TEXT PRIMARY KEY,
  tenant_id         TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  warehouse_item_id TEXT NOT NULL REFERENCES warehouse_items(id) ON DELETE CASCADE,
  movement_type     TEXT NOT NULL
                    CHECK (movement_type IN (
                      'receive','issue','transfer','adjust','install',
                      'uninstall','decommission','return','damage','repair'
                    )),
  quantity_delta    INTEGER NOT NULL,
  condition_from    TEXT,
  condition_to      TEXT,
  destination       TEXT,                             -- 'unit:<id>', 'vendor:<id>', 'warehouse:<loc>'
  related_case_id   TEXT,                             -- maintenance case triggering movement
  related_unit_id   TEXT,                             -- unit where item was installed/removed
  reason            TEXT,
  performed_by      TEXT NOT NULL,
  occurred_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_warehouse_movements_tenant ON warehouse_movements(tenant_id);
CREATE INDEX IF NOT EXISTS idx_warehouse_movements_item ON warehouse_movements(warehouse_item_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_warehouse_movements_type ON warehouse_movements(tenant_id, movement_type);
CREATE INDEX IF NOT EXISTS idx_warehouse_movements_case ON warehouse_movements(related_case_id)
  WHERE related_case_id IS NOT NULL;
