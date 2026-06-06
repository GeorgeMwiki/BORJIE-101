/**
 * Drizzle-backed `InventoryStore` for `@borjie/inventory-management`.
 *
 * Implements the package's `InventoryStore` port against the durable tables
 * `inventory_skus` + `inventory_stock_movements` (migration 0292), so the
 * package's pure-function compute (reorder candidates, ABC bands, on-hand
 * value, dead-stock, turnover, shrinkage) runs on REAL persisted rows.
 *
 * Tenant isolation is enforced in TWO layers:
 *   1. RLS — both tables FORCE-enable row-level security on the canonical
 *      `app.current_tenant_id` GUC, bound per request by databaseMiddleware.
 *   2. Defence-in-depth — every read ALSO filters by the caller-supplied
 *      `tenantId`, and every insert carries `tenantId` on the row.
 *
 * ONLY two of the seven port collections have backing tables in this wave:
 * SKUs and stock movements (the collections the compute actually reads). The
 * remaining collections (categories / locations / asset-serials / asset-events
 * / cycle-counts) are NOT yet modelled — their `load*` return an empty array
 * (honest: there is genuinely nothing stored), and their `persist*` throw
 * `UnsupportedInventoryCollectionError` so a caller can never silently lose
 * data into a void. The inventory route only invokes the SKU + movement paths.
 *
 * Movements are APPEND-ONLY: `persistMovement` only ever INSERTs; corrections
 * are new adjustment rows, never an UPDATE/DELETE of a prior movement.
 *
 * The Drizzle client is typed `DrizzleLike` (`any`) at the seam: the fluent
 * builder generics cannot be reproduced through the `@borjie/database` barrel
 * without tripping TS2709 (see `ai-native/drizzle-repos.ts` for the rationale).
 * Every row is mapped through an explicit converter, so callers stay typed.
 *
 * No `console.log` — failures propagate to the route's error envelope.
 */

import { eq } from 'drizzle-orm';
import { inventorySkus, inventoryStockMovements } from '@borjie/database';
import type {
  InventoryStore,
  AssetEvent,
  AssetSerial,
  CycleCount,
  Sku,
  SkuCategory,
  StockLocation,
  StockMovement,
  TenantId,
} from '@borjie/inventory-management';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DrizzleLike = any;

/** Thrown when a caller tries to persist into a not-yet-modelled collection. */
export class UnsupportedInventoryCollectionError extends Error {
  constructor(collection: string) {
    super(
      `inventory collection '${collection}' has no durable table in this wave`,
    );
    this.name = 'UnsupportedInventoryCollectionError';
  }
}

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return new Date().toISOString();
}

function toIsoOrUndefined(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  return toIso(value);
}

/** Map an `inventory_skus` row → the package `Sku` shape. */
function rowToSku(row: Record<string, unknown>): Sku {
  const archivedAt = toIsoOrUndefined(row.archivedAt);
  return {
    id: String(row.id),
    tenantId: String(row.tenantId),
    code: String(row.code),
    name: String(row.name),
    ...(row.description != null ? { description: String(row.description) } : {}),
    categoryId: row.categoryId != null ? String(row.categoryId) : null,
    unit: String(row.unit) as Sku['unit'],
    defaultUnitCostCents: Number(row.defaultUnitCostCents ?? 0),
    minimumStockLevel: Number(row.minimumStockLevel ?? 0),
    reorderQty: Number(row.reorderQty ?? 0),
    leadTimeDays: Number(row.leadTimeDays ?? 0),
    isAsset: Boolean(row.isAsset),
    ...(row.barcode != null ? { barcode: String(row.barcode) } : {}),
    ...(row.qrCode != null ? { qrCode: String(row.qrCode) } : {}),
    supplierVendorIds: Array.isArray(row.supplierVendorIds)
      ? (row.supplierVendorIds as unknown[]).map(String)
      : [],
    ...(archivedAt ? { archivedAt } : {}),
  };
}

/** Map an `inventory_stock_movements` row → the package `StockMovement`. */
function rowToMovement(row: Record<string, unknown>): StockMovement {
  return {
    id: String(row.id),
    tenantId: String(row.tenantId),
    skuId: String(row.skuId),
    fromLocationId: row.fromLocationId != null ? String(row.fromLocationId) : null,
    toLocationId: row.toLocationId != null ? String(row.toLocationId) : null,
    quantity: Number(row.quantity ?? 0),
    reason: String(row.reason) as StockMovement['reason'],
    ...(row.condition != null
      ? { condition: String(row.condition) as NonNullable<StockMovement['condition']> }
      : {}),
    ...(row.reference != null ? { reference: String(row.reference) } : {}),
    ...(row.actorUserId != null ? { actorUserId: String(row.actorUserId) } : {}),
    ...(row.assetSerialId != null
      ? { assetSerialId: String(row.assetSerialId) }
      : {}),
    ...(row.notes != null ? { notes: String(row.notes) } : {}),
    occurredAt: toIso(row.occurredAt),
  };
}

/**
 * Build a Drizzle-backed `InventoryStore` bound to the request's RLS-pinned
 * client. Construct one per request inside the route handler.
 */
export function createDrizzleInventoryStore(db: DrizzleLike): InventoryStore {
  return {
    loadSkus: async (tenantId: TenantId): Promise<ReadonlyArray<Sku>> => {
      const rows = await db
        .select()
        .from(inventorySkus)
        .where(eq(inventorySkus.tenantId, tenantId));
      return (rows as Array<Record<string, unknown>>).map(rowToSku);
    },

    loadMovements: async (
      tenantId: TenantId,
    ): Promise<ReadonlyArray<StockMovement>> => {
      const rows = await db
        .select()
        .from(inventoryStockMovements)
        .where(eq(inventoryStockMovements.tenantId, tenantId));
      return (rows as Array<Record<string, unknown>>).map(rowToMovement);
    },

    // Collections without a durable table in this wave — honest empties.
    loadCategories: async (): Promise<ReadonlyArray<SkuCategory>> => [],
    loadLocations: async (): Promise<ReadonlyArray<StockLocation>> => [],
    loadAssets: async (): Promise<ReadonlyArray<AssetSerial>> => [],
    loadAssetEvents: async (): Promise<ReadonlyArray<AssetEvent>> => [],
    loadCycleCounts: async (): Promise<ReadonlyArray<CycleCount>> => [],

    persistSku: async (sku: Sku): Promise<void> => {
      const values = {
        id: sku.id,
        tenantId: sku.tenantId,
        code: sku.code,
        name: sku.name,
        description: sku.description ?? null,
        categoryId: sku.categoryId ?? null,
        unit: sku.unit,
        defaultUnitCostCents: sku.defaultUnitCostCents,
        minimumStockLevel: sku.minimumStockLevel,
        reorderQty: sku.reorderQty,
        leadTimeDays: sku.leadTimeDays,
        isAsset: sku.isAsset,
        barcode: sku.barcode ?? null,
        qrCode: sku.qrCode ?? null,
        supplierVendorIds: sku.supplierVendorIds
          ? [...sku.supplierVendorIds]
          : [],
        archivedAt: sku.archivedAt ? new Date(sku.archivedAt) : null,
        updatedAt: new Date(),
      };
      await db
        .insert(inventorySkus)
        .values(values)
        .onConflictDoUpdate({
          target: inventorySkus.id,
          set: {
            code: values.code,
            name: values.name,
            description: values.description,
            categoryId: values.categoryId,
            unit: values.unit,
            defaultUnitCostCents: values.defaultUnitCostCents,
            minimumStockLevel: values.minimumStockLevel,
            reorderQty: values.reorderQty,
            leadTimeDays: values.leadTimeDays,
            isAsset: values.isAsset,
            barcode: values.barcode,
            qrCode: values.qrCode,
            supplierVendorIds: values.supplierVendorIds,
            archivedAt: values.archivedAt,
            updatedAt: values.updatedAt,
          },
        });
    },

    // Append-only — INSERT only, never update/delete a prior movement.
    persistMovement: async (movement: StockMovement): Promise<void> => {
      await db.insert(inventoryStockMovements).values({
        id: movement.id,
        tenantId: movement.tenantId,
        skuId: movement.skuId,
        fromLocationId: movement.fromLocationId,
        toLocationId: movement.toLocationId,
        quantity: movement.quantity,
        reason: movement.reason,
        condition: movement.condition ?? null,
        reference: movement.reference ?? null,
        actorUserId: movement.actorUserId ?? null,
        assetSerialId: movement.assetSerialId ?? null,
        notes: movement.notes ?? null,
        occurredAt: new Date(movement.occurredAt),
      });
    },

    persistCategory: async (): Promise<void> => {
      throw new UnsupportedInventoryCollectionError('categories');
    },
    persistLocation: async (): Promise<void> => {
      throw new UnsupportedInventoryCollectionError('locations');
    },
    persistAsset: async (): Promise<void> => {
      throw new UnsupportedInventoryCollectionError('asset-serials');
    },
    persistAssetEvent: async (): Promise<void> => {
      throw new UnsupportedInventoryCollectionError('asset-events');
    },
    persistCycleCount: async (): Promise<void> => {
      throw new UnsupportedInventoryCollectionError('cycle-counts');
    },
  };
}
