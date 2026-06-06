/**
 * inventory_skus + inventory_stock_movements (migration 0292) —
 * `@borjie/inventory-management` durable store.
 *
 * Two collections back the package's pure-function compute (ABC bands,
 * reorder candidates, on-hand value, dead-stock, turnover, shrinkage):
 *   - inventory_skus            — the fungible-item catalog.
 *   - inventory_stock_movements — the APPEND-ONLY event log. On-hand for any
 *     (sku, location) is DERIVED by replaying this log; there is no mutable
 *     balance column (mirrors the package's `currentStock` / `allBalances`).
 *
 * Tenant scope (CLAUDE.md hard rule — mirrors migration 0292): tenant_id is
 * TEXT and FK→tenants; both tables FORCE-enable RLS on the canonical
 * `app.current_tenant_id` GUC. The Drizzle store also filters every read by
 * tenantId for defence-in-depth.
 *
 * Currency neutrality (CLAUDE.md hard rule): the only money column is
 * `defaultUnitCostCents` — an INTEGER minor-units figure in the tenant's
 * reporting currency. No currency literal anywhere.
 *
 * Companion to:
 *   - packages/database/src/migrations/0292_inventory_management.sql
 *   - services/api-gateway/src/composition/inventory/drizzle-inventory-store.ts
 */

import {
  pgTable,
  text,
  integer,
  boolean,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenant.schema.js';

export const inventorySkus = pgTable(
  'inventory_skus',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    categoryId: text('category_id'),
    /** each|kg|g|L|mL|m|cm|mm|box|roll|pack|pair|set. */
    unit: text('unit').notNull().default('each'),
    /** Default unit cost in INTEGER minor-units of the tenant currency. */
    defaultUnitCostCents: integer('default_unit_cost_cents')
      .notNull()
      .default(0),
    minimumStockLevel: integer('minimum_stock_level').notNull().default(0),
    reorderQty: integer('reorder_qty').notNull().default(0),
    leadTimeDays: integer('lead_time_days').notNull().default(0),
    isAsset: boolean('is_asset').notNull().default(false),
    barcode: text('barcode'),
    qrCode: text('qr_code'),
    supplierVendorIds: text('supplier_vendor_ids')
      .array()
      .notNull()
      .default([]),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantCodeIdx: uniqueIndex('inventory_skus_tenant_code_idx').on(
      t.tenantId,
      t.code,
    ),
    tenantIdx: index('inventory_skus_tenant_idx').on(t.tenantId),
    tenantCategoryIdx: index('inventory_skus_tenant_category_idx').on(
      t.tenantId,
      t.categoryId,
    ),
  }),
);

export const inventoryStockMovements = pgTable(
  'inventory_stock_movements',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    skuId: text('sku_id')
      .notNull()
      .references(() => inventorySkus.id, { onDelete: 'cascade' }),
    /** NULL from = inbound receipt; NULL to = outbound issue. */
    fromLocationId: text('from_location_id'),
    toLocationId: text('to_location_id'),
    quantity: integer('quantity').notNull(),
    /** receipt|issue|transfer|adjustment|return|damage|loss|theft|install|uninstall. */
    reason: text('reason').notNull(),
    /** new|refurbished|used|broken|in_transit|reserved. */
    condition: text('condition'),
    reference: text('reference'),
    actorUserId: text('actor_user_id'),
    assetSerialId: text('asset_serial_id'),
    notes: text('notes'),
    occurredAt: timestamp('occurred_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantIdx: index('inventory_stock_movements_tenant_idx').on(t.tenantId),
    tenantSkuIdx: index('inventory_stock_movements_tenant_sku_idx').on(
      t.tenantId,
      t.skuId,
    ),
    tenantOccurredIdx: index(
      'inventory_stock_movements_tenant_occurred_idx',
    ).on(t.tenantId, t.occurredAt),
  }),
);

export type InventorySkuRow = typeof inventorySkus.$inferSelect;
export type InventoryStockMovementRow =
  typeof inventoryStockMovements.$inferSelect;
