-- =============================================================================
-- Down-migration 0292 — reverse inventory_management.
--
-- Dev/staging only. Dropping these tables loses the entire consumables/spares
-- SKU catalog AND the append-only stock-movement ledger (every receipt / issue
-- / adjustment). A production rollback must export both tables first if any
-- inventory history is retained for audit / valuation purposes.
--
-- Drop order: movements first (FK → inventory_skus), then the catalog.
--
-- Reverses migration 0292_inventory_management.sql.
-- =============================================================================

BEGIN;

DROP POLICY IF EXISTS inventory_stock_movements_tenant_isolation
  ON inventory_stock_movements;
DROP POLICY IF EXISTS inventory_skus_tenant_isolation
  ON inventory_skus;

DROP INDEX IF EXISTS inventory_stock_movements_tenant_occurred_idx;
DROP INDEX IF EXISTS inventory_stock_movements_tenant_sku_idx;
DROP INDEX IF EXISTS inventory_stock_movements_tenant_idx;
DROP INDEX IF EXISTS inventory_skus_tenant_category_idx;
DROP INDEX IF EXISTS inventory_skus_tenant_idx;
DROP INDEX IF EXISTS inventory_skus_tenant_code_idx;

DROP TABLE IF EXISTS inventory_stock_movements;
DROP TABLE IF EXISTS inventory_skus;

COMMIT;
