/**
 * Public types for `@borjie/inventory-management`.
 *
 * Estate orgs hold inventory: spare parts, cleaning supplies, light
 * bulbs, paint, security gadgets, appliances destined for units.
 *
 * Two distinct concepts live in this package:
 *
 *  1. SKU + stock-item — a *fungible* item line (e.g. 50 boxes of
 *     light bulbs at warehouse A). Quantity is integer + condition.
 *
 *  2. Asset serial — a *serialised* unit of an `isAsset` SKU (e.g.
 *     refrigerator #ABC123 installed in unit #U-409). Has its own
 *     lifecycle: install → maintain → decommission.
 *
 * Every type is `readonly` end-to-end so consumers cannot mutate
 * records returned by the read paths.
 */

// ─────────────────────────────────────────────────────────────────────
// Identifiers
// ─────────────────────────────────────────────────────────────────────

export type TenantId = string;
export type SkuId = string;
export type LocationId = string;
export type ItemId = string;
export type MovementId = string;
export type AssetSerialId = string;
export type CycleCountId = string;
export type CategoryId = string;
export type UnitId = string;
export type VendorId = string;
export type UserId = string;

/** ISO-4217 currency code (cents-denominated values record their currency at the tenant level). */
export type CurrencyCode = string;

/** Unit of measure for fungible items. */
export const SKU_UNITS = [
  'each',
  'kg',
  'g',
  'L',
  'mL',
  'm',
  'cm',
  'mm',
  'box',
  'roll',
  'pack',
  'pair',
  'set',
] as const;

export type SkuUnit = (typeof SKU_UNITS)[number];

// ─────────────────────────────────────────────────────────────────────
// SKU + category
// ─────────────────────────────────────────────────────────────────────

export interface SkuCategory {
  readonly id: CategoryId;
  readonly tenantId: TenantId;
  readonly name: string;
  readonly parentCategoryId: CategoryId | null;
  readonly description?: string;
}

export interface Sku {
  readonly id: SkuId;
  readonly tenantId: TenantId;
  readonly code: string;                  // human-readable, unique per tenant
  readonly name: string;
  readonly description?: string;
  readonly categoryId: CategoryId | null;
  readonly unit: SkuUnit;
  /** Default unit cost in cents of the tenant's reporting currency. */
  readonly defaultUnitCostCents: number;
  /** Reorder trigger — when total stock dips below this, the SKU is a reorder candidate. */
  readonly minimumStockLevel: number;
  /** Default replenishment qty when generating a purchase-order draft. */
  readonly reorderQty: number;
  /** Vendor lead-time in days — used to project a reorder date. */
  readonly leadTimeDays: number;
  /** When TRUE: each unit is tracked as an `AssetSerial` (appliances, security gadgets). */
  readonly isAsset: boolean;
  readonly images?: ReadonlyArray<string>;
  readonly barcode?: string;
  readonly qrCode?: string;
  readonly supplierVendorIds?: ReadonlyArray<VendorId>;
  readonly archivedAt?: string;
}

/** Bulk-import row — looser, validated + normalised to `Sku`. */
export interface SkuImportRow {
  readonly code: string;
  readonly name: string;
  readonly unit: string;
  readonly defaultUnitCostCents?: number;
  readonly minimumStockLevel?: number;
  readonly reorderQty?: number;
  readonly leadTimeDays?: number;
  readonly isAsset?: boolean;
  readonly category?: string;
  readonly description?: string;
  readonly barcode?: string;
}

// ─────────────────────────────────────────────────────────────────────
// Stock locations — hierarchical
// ─────────────────────────────────────────────────────────────────────

export const LOCATION_KINDS = [
  'warehouse',
  'zone',
  'rack',
  'bin',
  'store',
  'property',
  'unit',
  'vehicle',
  'in_transit',
] as const;

export type LocationKind = (typeof LOCATION_KINDS)[number];

export interface StockLocation {
  readonly id: LocationId;
  readonly tenantId: TenantId;
  readonly name: string;
  readonly kind: LocationKind;
  readonly parentLocationId: LocationId | null;
  readonly address?: string;
  readonly geoLat?: number;
  readonly geoLng?: number;
  readonly managerUserId?: UserId;
  /** When this is a `property` or `unit` location, the link to the property/unit row. */
  readonly propertyId?: string;
  readonly unitId?: UnitId;
  readonly archivedAt?: string;
}

// ─────────────────────────────────────────────────────────────────────
// Stock items + condition
// ─────────────────────────────────────────────────────────────────────

export const ITEM_CONDITIONS = [
  'new',
  'refurbished',
  'used',
  'broken',
  'in_transit',
  'reserved',
] as const;

export type ItemCondition = (typeof ITEM_CONDITIONS)[number];

export interface StockItem {
  readonly id: ItemId;
  readonly tenantId: TenantId;
  readonly skuId: SkuId;
  readonly locationId: LocationId;
  readonly quantity: number;
  readonly condition: ItemCondition;
  readonly batchNumber?: string;
  readonly expiryDate?: string;        // ISO date
  readonly lastCountedAt?: string;
  readonly lastMovementAt?: string;
}

// ─────────────────────────────────────────────────────────────────────
// Movements — append-only event log
// ─────────────────────────────────────────────────────────────────────

export const MOVEMENT_REASONS = [
  'receipt',
  'issue',
  'transfer',
  'adjustment',
  'return',
  'damage',
  'loss',
  'theft',
  'install',
  'uninstall',
] as const;

export type MovementReason = (typeof MOVEMENT_REASONS)[number];

export interface StockMovement {
  readonly id: MovementId;
  readonly tenantId: TenantId;
  readonly skuId: SkuId;
  readonly fromLocationId: LocationId | null;
  readonly toLocationId: LocationId | null;
  readonly quantity: number;
  readonly reason: MovementReason;
  readonly condition?: ItemCondition;
  /** PO / work-order / maintenance / lease reference for the audit trail. */
  readonly reference?: string;
  readonly actorUserId?: UserId;
  readonly assetSerialId?: AssetSerialId;
  readonly notes?: string;
  readonly occurredAt: string;
}

// ─────────────────────────────────────────────────────────────────────
// Asset serials — for `isAsset=true` SKUs
// ─────────────────────────────────────────────────────────────────────

export const ASSET_STATUSES = [
  'in_stock',
  'installed',
  'in_repair',
  'decommissioned',
  'lost',
] as const;

export type AssetStatus = (typeof ASSET_STATUSES)[number];

export interface AssetSerial {
  readonly id: AssetSerialId;
  readonly tenantId: TenantId;
  readonly skuId: SkuId;
  readonly serialNumber: string;
  readonly status: AssetStatus;
  readonly currentLocationId: LocationId | null;
  readonly installedInUnitId: UnitId | null;
  readonly installedAt?: string;
  readonly installedByUserId?: UserId;
  readonly warrantyExpiresAt?: string;
  readonly purchaseDate?: string;
  readonly purchaseCostCents?: number;
  readonly photos?: ReadonlyArray<string>;
  readonly notes?: string;
}

export interface AssetEvent {
  readonly id: string;
  readonly assetSerialId: AssetSerialId;
  readonly eventType:
    | 'received'
    | 'installed'
    | 'maintenance'
    | 'removed'
    | 'transferred'
    | 'decommissioned';
  readonly occurredAt: string;
  readonly actorUserId?: UserId;
  readonly unitId?: UnitId;
  readonly notes?: string;
  /** Maintenance work-order / job reference. */
  readonly reference?: string;
}

// ─────────────────────────────────────────────────────────────────────
// Cycle counts
// ─────────────────────────────────────────────────────────────────────

export const CYCLE_COUNT_STATUSES = [
  'scheduled',
  'in_progress',
  'completed',
  'cancelled',
] as const;

export type CycleCountStatus = (typeof CYCLE_COUNT_STATUSES)[number];

export const CYCLE_COUNT_MODES = ['full', 'random_sample', 'abc_priority'] as const;
export type CycleCountMode = (typeof CYCLE_COUNT_MODES)[number];

export interface CycleCountVariance {
  readonly skuId: SkuId;
  readonly locationId: LocationId;
  readonly expectedQty: number;
  readonly countedQty: number;
  readonly delta: number;
}

export interface CycleCount {
  readonly id: CycleCountId;
  readonly tenantId: TenantId;
  readonly locationId: LocationId;
  readonly mode: CycleCountMode;
  readonly scheduledAt: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly status: CycleCountStatus;
  readonly variances: ReadonlyArray<CycleCountVariance>;
  readonly notes?: string;
}

// ─────────────────────────────────────────────────────────────────────
// Reorder + purchase-order suggestion
// ─────────────────────────────────────────────────────────────────────

export interface ReorderCandidate {
  readonly skuId: SkuId;
  readonly locationId: LocationId;
  readonly onHand: number;
  readonly minimumStockLevel: number;
  readonly shortfall: number;
  readonly suggestedQty: number;
  readonly leadTimeDays: number;
  readonly defaultUnitCostCents: number;
  /** ABC band by Pareto value-on-hand. */
  readonly abcBand: 'A' | 'B' | 'C';
}

export interface POSpecLine {
  readonly skuId: SkuId;
  readonly quantity: number;
  readonly unitCostCents: number;
}

export interface POSpec {
  readonly tenantId: TenantId;
  readonly vendorId: VendorId | 'unassigned';
  readonly lines: ReadonlyArray<POSpecLine>;
  readonly subtotalCents: number;
  readonly notes?: string;
}

// ─────────────────────────────────────────────────────────────────────
// Analytics
// ─────────────────────────────────────────────────────────────────────

export interface StockOnHandSnapshot {
  readonly tenantId: TenantId;
  readonly locationId: LocationId | null;
  readonly byCategoryValueCents: Readonly<Record<string, number>>;
  readonly totalValueCents: number;
  readonly snapshotAt: string;
}

export interface InventoryTurnover {
  readonly skuId: SkuId;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly issuedQty: number;
  readonly avgOnHand: number;
  readonly turnover: number;          // issuedQty / avgOnHand
}

export interface DeadStockItem {
  readonly skuId: SkuId;
  readonly locationId: LocationId;
  readonly onHand: number;
  readonly lastMovementAt: string | null;
  readonly daysSinceMovement: number | null;
}

export interface ShrinkageSummary {
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly totalAdjustmentsValueCents: number;
  readonly netShrinkagePct: number;
  readonly byCycleCountId: ReadonlyArray<{
    readonly cycleCountId: CycleCountId;
    readonly varianceCount: number;
    readonly netValueCents: number;
  }>;
}

export interface ConsumptionHotspot {
  readonly skuId: SkuId;
  readonly locationId: LocationId;
  readonly issuedQty: number;
  readonly issuedValueCents: number;
}

// ─────────────────────────────────────────────────────────────────────
// Result / error envelope (shared across operations)
// ─────────────────────────────────────────────────────────────────────

export type Result<T, E extends string = string> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code: E; readonly message: string } };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E extends string>(code: E, message: string): Result<never, E> {
  return { ok: false, error: { code, message } };
}
