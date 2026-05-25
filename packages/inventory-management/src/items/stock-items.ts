/**
 * Stock-item views over the movement log.
 *
 * A "stock item" is the *derived* state — for a given SKU + location +
 * condition triple, what is the current quantity. The persistence
 * layer can cache these for read speed, but the source of truth is
 * always the append-only movement log.
 *
 * For `isAsset=true` SKUs each unit is also represented as an
 * `AssetSerial` with its own lifecycle status. Aggregate stock for an
 * asset SKU at a location is the count of serials currently sitting
 * there.
 */

import {
  type AssetSerial,
  type ItemCondition,
  type LocationId,
  type SkuId,
  type StockItem,
  type StockMovement,
  type TenantId,
} from '../types.js';
import { allBalances, currentStock } from '../movements/stock-movements.js';

export interface StockItemView extends StockItem {}

/**
 * Snapshot of all stock items for a tenant. Aggregates the movement
 * log by (sku, location). When the same SKU sits at the same location
 * with multiple conditions in the *recorded* movements, the view keeps
 * the *latest* condition seen — condition is a soft attribute, not a
 * key.
 */
export function snapshotStockItems(
  log: ReadonlyArray<StockMovement>,
  tenantId: TenantId,
  now: string,
  idGen: () => string,
): ReadonlyArray<StockItemView> {
  const balances = allBalances(log, tenantId);
  const conditionByPair = new Map<string, { condition: ItemCondition; movedAt: string }>();
  for (const m of log) {
    if (m.tenantId !== tenantId) continue;
    if (m.toLocationId && m.condition) {
      const key = `${m.skuId}::${m.toLocationId}`;
      const prev = conditionByPair.get(key);
      if (!prev || m.occurredAt >= prev.movedAt) {
        conditionByPair.set(key, { condition: m.condition, movedAt: m.occurredAt });
      }
    }
  }
  return balances
    .filter((b) => b.quantity > 0)
    .map((b) => {
      const key = `${b.skuId}::${b.locationId}`;
      const cond = conditionByPair.get(key)?.condition ?? 'new';
      const lastMovementAt =
        [...log]
          .filter((m) => m.tenantId === tenantId && m.skuId === b.skuId && (m.fromLocationId === b.locationId || m.toLocationId === b.locationId))
          .map((m) => m.occurredAt)
          .sort()
          .at(-1) ?? now;
      return {
        id: idGen(),
        tenantId,
        skuId: b.skuId,
        locationId: b.locationId,
        quantity: b.quantity,
        condition: cond,
        lastMovementAt,
      };
    });
}

/**
 * Single-pair stock lookup — thin wrapper over `currentStock` so
 * callers can `import { onHandFor } from '@borjie/inventory-management'`.
 */
export function onHandFor(
  log: ReadonlyArray<StockMovement>,
  tenantId: TenantId,
  skuId: SkuId,
  locationId: LocationId,
): number {
  return currentStock(log, tenantId, skuId, locationId);
}

/**
 * Aggregate stock across all locations for one SKU.
 */
export function totalOnHandForSku(
  log: ReadonlyArray<StockMovement>,
  tenantId: TenantId,
  skuId: SkuId,
): number {
  let total = 0;
  for (const m of log) {
    if (m.tenantId !== tenantId) continue;
    if (m.skuId !== skuId) continue;
    if (m.toLocationId) total += m.quantity;
    if (m.fromLocationId) total -= m.quantity;
  }
  return total;
}

/**
 * For `isAsset=true` SKUs — return per-serial records that match the
 * given SKU. Caller can further filter by `status` or `currentLocationId`.
 */
export function serialsForSku(
  serials: ReadonlyArray<AssetSerial>,
  tenantId: TenantId,
  skuId: SkuId,
): ReadonlyArray<AssetSerial> {
  return serials.filter((s) => s.tenantId === tenantId && s.skuId === skuId);
}
