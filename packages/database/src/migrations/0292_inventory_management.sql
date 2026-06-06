-- =============================================================================
-- Migration 0292 — inventory_management (consumables / spares SKU catalog +
-- append-only stock-movement ledger).
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- `@borjie/inventory-management` (createInventoryManagement) is a bag of pure
-- functions (ABC bands, reorder candidates, on-hand-value, dead-stock,
-- turnover, shrinkage) that replay an APPEND-ONLY stock-movement log against a
-- SKU catalog. Until now those functions had no durable backing store in the
-- mining DB — the package shipped only an in-memory `InventoryStore` port. A
-- mining estate genuinely holds consumables + spares (drill bits, hydraulic
-- hose, grease, PPE, fuel filters, blasting accessories) distinct from the
-- capital `assets` register, so this migration stands up the REAL tables the
-- Drizzle `InventoryStore` adapter binds to.
--
-- We intentionally model ONLY the two collections the compute actually needs:
--   * inventory_skus              — the catalog (one row per fungible item line)
--   * inventory_stock_movements   — the append-only event log (receipts /
--                                   issues / transfers / adjustments / loss /
--                                   damage). On-hand for any (sku, location) is
--                                   DERIVED by replaying this log — never a
--                                   mutable balance column (matches the package
--                                   `currentStock` / `allBalances` semantics).
-- Stock LOCATIONS are kept as free-text ids (the package's `LocationId` is a
-- string) so we do not introduce a third table for a slice that is just a
-- label today — nothing is fabricated; the ledger carries the location refs.
--
-- TENANT SCOPE (CLAUDE.md hard rule — mirrors mig 0285 / 0289):
--   tenant_id is TEXT; FORCE ROW LEVEL SECURITY + a tenant policy on the
--   canonical `app.current_tenant_id` GUC (the GUC the api-gateway
--   databaseMiddleware binds). The compare is bare (no cast) because tenant_id
--   is already TEXT. NEVER the legacy app.tenant_id.
--
-- CURRENCY NEUTRALITY (CLAUDE.md hard rule): the only money column is
-- `default_unit_cost_cents` — an INTEGER minor-units figure in the tenant's
-- reporting currency. NO currency literal (TZS/USD/…) appears anywhere; the
-- currency is resolved per-tenant at render time.
--
-- APPEND-ONLY DISCIPLINE: inventory_stock_movements is an event log. The
-- Drizzle adapter only ever INSERTs; corrections are NEW adjustment rows, never
-- UPDATE/DELETE of a prior movement. (Enforced in code; the table shape mirrors
-- the immutable `StockMovement` port.)
--
-- ID DISCIPLINE: `id` is TEXT (the package generates string ids), NOT a uuid
-- default — matching `Sku.id: string` / `StockMovement.id: string`.
--
-- FRESH-DB SAFETY / IDEMPOTENCY (CLAUDE.md hard rule: migrations are immutable
-- + forward-only). Every object uses CREATE TABLE IF NOT EXISTS / guarded
-- DO-blocks (pg_policies checks) / CREATE INDEX IF NOT EXISTS, and a pg_roles
-- guard around the anon REVOKE. On a fully-migrated DB this is a pure no-op.
-- References only pre-existing infra (`tenants`).
--
-- Companion files:
--   * packages/database/src/schemas/inventory-management.schema.ts
--   * services/api-gateway/src/composition/inventory/drizzle-inventory-store.ts
--   * services/api-gateway/src/routes/mining/inventory.hono.ts
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- inventory_skus — fungible item catalog (one row per SKU per tenant).
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS inventory_skus (
  id                       text        PRIMARY KEY,
  tenant_id                text        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- Human-readable, unique per tenant (enforced by the unique index below).
  code                     text        NOT NULL,
  name                     text        NOT NULL,
  description              text,
  category_id              text,
  -- Unit of measure: each|kg|g|L|mL|m|cm|mm|box|roll|pack|pair|set.
  unit                     text        NOT NULL DEFAULT 'each',
  -- Default unit cost in INTEGER minor-units of the tenant reporting currency.
  default_unit_cost_cents  integer     NOT NULL DEFAULT 0,
  -- Reorder trigger: when total on-hand dips at/below this, SKU is a candidate.
  minimum_stock_level      integer     NOT NULL DEFAULT 0,
  -- Default replenishment qty when generating a purchase-order draft.
  reorder_qty              integer     NOT NULL DEFAULT 0,
  -- Vendor lead-time in days — used to project a reorder date.
  lead_time_days           integer     NOT NULL DEFAULT 0,
  -- TRUE when each unit is serialised (tracked as an asset elsewhere).
  is_asset                 boolean     NOT NULL DEFAULT false,
  barcode                  text,
  qr_code                  text,
  -- Candidate supplier vendor ids (free-text refs into procurement vendors).
  supplier_vendor_ids      text[]      NOT NULL DEFAULT '{}',
  archived_at              timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS inventory_skus_tenant_code_idx
  ON inventory_skus (tenant_id, code);

CREATE INDEX IF NOT EXISTS inventory_skus_tenant_idx
  ON inventory_skus (tenant_id);

CREATE INDEX IF NOT EXISTS inventory_skus_tenant_category_idx
  ON inventory_skus (tenant_id, category_id);

-- -----------------------------------------------------------------------------
-- inventory_stock_movements — append-only stock event log.
-- On-hand is DERIVED by replaying this log; there is no balance column.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS inventory_stock_movements (
  id                  text        PRIMARY KEY,
  tenant_id           text        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sku_id              text        NOT NULL REFERENCES inventory_skus(id) ON DELETE CASCADE,
  -- NULL from_location = inbound receipt; NULL to_location = outbound issue.
  from_location_id    text,
  to_location_id      text,
  quantity            integer     NOT NULL,
  -- receipt|issue|transfer|adjustment|return|damage|loss|theft|install|uninstall.
  reason              text        NOT NULL,
  -- new|refurbished|used|broken|in_transit|reserved.
  condition           text,
  -- PO / work-order / maintenance / lease reference for the audit trail.
  reference           text,
  actor_user_id       text,
  asset_serial_id     text,
  notes               text,
  occurred_at         timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS inventory_stock_movements_tenant_idx
  ON inventory_stock_movements (tenant_id);

CREATE INDEX IF NOT EXISTS inventory_stock_movements_tenant_sku_idx
  ON inventory_stock_movements (tenant_id, sku_id);

CREATE INDEX IF NOT EXISTS inventory_stock_movements_tenant_occurred_idx
  ON inventory_stock_movements (tenant_id, occurred_at);

-- -----------------------------------------------------------------------------
-- RLS — tenant isolation on the canonical GUC (FORCE so the owner role
-- cannot bypass it either).
-- -----------------------------------------------------------------------------

ALTER TABLE inventory_skus            ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_skus            FORCE  ROW LEVEL SECURITY;
ALTER TABLE inventory_stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_stock_movements FORCE  ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'inventory_skus'
       AND policyname = 'inventory_skus_tenant_isolation'
  ) THEN
    CREATE POLICY inventory_skus_tenant_isolation
      ON inventory_skus
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'inventory_stock_movements'
       AND policyname = 'inventory_stock_movements_tenant_isolation'
  ) THEN
    CREATE POLICY inventory_stock_movements_tenant_isolation
      ON inventory_stock_movements
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- Lock down the anon role (Supabase-only; guarded for vanilla Postgres / CI).
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON public.inventory_skus FROM anon;';
    EXECUTE 'REVOKE ALL ON public.inventory_stock_movements FROM anon;';
  END IF;
END $$;

COMMIT;
