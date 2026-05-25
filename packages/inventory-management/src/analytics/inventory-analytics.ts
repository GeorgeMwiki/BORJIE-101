/**
 * Inventory analytics — pure read-only derivations over the catalog +
 * the movement log.
 *
 *  - `stockOnHandValue` — Σ qty × unitCost per category / per location.
 *  - `inventoryTurnover` — issuedQty / avgOnHand for a given period.
 *  - `deadStockReport` — SKUs with no movement in ≥ N days.
 *  - `stockOutIncidents` — count of distinct (sku, location) pairs that
 *    have hit zero in the period.
 *  - `shrinkageReport` — net adjustment value over a period, attributed
 *    to source cycle-counts when the movement reference points at one.
 *  - `consumptionHotspots` — top-N (sku, location) pairs by issued qty.
 */

import {
  type ConsumptionHotspot,
  type CycleCountId,
  type DeadStockItem,
  type InventoryTurnover,
  type LocationId,
  type ShrinkageSummary,
  type Sku,
  type SkuCategory,
  type SkuId,
  type StockMovement,
  type StockOnHandSnapshot,
  type TenantId,
} from '../types.js';
import { allBalances, currentStock } from '../movements/stock-movements.js';

export function stockOnHandValue(
  skus: ReadonlyArray<Sku>,
  categories: ReadonlyArray<SkuCategory>,
  log: ReadonlyArray<StockMovement>,
  tenantId: TenantId,
  locationId: LocationId | null,
  now: string,
): StockOnHandSnapshot {
  const categoryName = new Map(categories.filter((c) => c.tenantId === tenantId).map((c) => [c.id, c.name]));
  const skuById = new Map(skus.filter((s) => s.tenantId === tenantId).map((s) => [s.id, s]));
  const byCategoryValueCents: Record<string, number> = {};
  let totalValueCents = 0;
  if (locationId) {
    for (const sku of skuById.values()) {
      const qty = currentStock(log, tenantId, sku.id, locationId);
      if (qty <= 0) continue;
      const v = qty * sku.defaultUnitCostCents;
      const catName = (sku.categoryId && categoryName.get(sku.categoryId)) || 'Uncategorised';
      byCategoryValueCents[catName] = (byCategoryValueCents[catName] ?? 0) + v;
      totalValueCents += v;
    }
  } else {
    for (const bal of allBalances(log, tenantId)) {
      if (bal.quantity <= 0) continue;
      const sku = skuById.get(bal.skuId);
      if (!sku) continue;
      const v = bal.quantity * sku.defaultUnitCostCents;
      const catName = (sku.categoryId && categoryName.get(sku.categoryId)) || 'Uncategorised';
      byCategoryValueCents[catName] = (byCategoryValueCents[catName] ?? 0) + v;
      totalValueCents += v;
    }
  }
  return {
    tenantId,
    locationId,
    byCategoryValueCents,
    totalValueCents,
    snapshotAt: now,
  };
}

/**
 * Inventory turnover per SKU for a period.
 *
 *   turnover = issuedQty(period) / avgOnHand(period)
 *
 * `avgOnHand` is approximated as the simple mean of opening + closing
 * on-hand. Industry rule-of-thumb thresholds:
 *   - turnover < 1 over an FY → slow-mover (potential dead stock),
 *   - 1-4 over an FY → healthy,
 *   - > 4 over an FY → high-velocity (review reorder par-levels).
 */
export function inventoryTurnover(
  log: ReadonlyArray<StockMovement>,
  tenantId: TenantId,
  skuId: SkuId,
  periodStart: string,
  periodEnd: string,
): InventoryTurnover {
  const startMs = Date.parse(periodStart);
  const endMs = Date.parse(periodEnd);
  // Opening on-hand = sum of movements before periodStart across all locations.
  let opening = 0;
  let closing = 0;
  let issuedQty = 0;
  for (const m of log) {
    if (m.tenantId !== tenantId) continue;
    if (m.skuId !== skuId) continue;
    const t = Date.parse(m.occurredAt);
    if (t < startMs) {
      if (m.toLocationId) opening += m.quantity;
      if (m.fromLocationId) opening -= m.quantity;
    }
    if (t <= endMs) {
      if (m.toLocationId) closing += m.quantity;
      if (m.fromLocationId) closing -= m.quantity;
    }
    if (t >= startMs && t <= endMs && (m.reason === 'issue' || m.reason === 'install')) {
      issuedQty += m.quantity;
    }
  }
  const avgOnHand = (opening + closing) / 2;
  const turnover = avgOnHand > 0 ? issuedQty / avgOnHand : 0;
  return { skuId, periodStart, periodEnd, issuedQty, avgOnHand, turnover };
}

/**
 * Dead-stock detection — SKU+location pairs with no movement in
 * `staleDays` days AND a positive on-hand. Defaults to 180 days
 * (the conservative "two ordering cycles for slow-mover" threshold).
 */
export function deadStockReport(
  log: ReadonlyArray<StockMovement>,
  tenantId: TenantId,
  now: string,
  staleDays = 180,
): ReadonlyArray<DeadStockItem> {
  const nowMs = Date.parse(now);
  const cutoffMs = nowMs - staleDays * 86_400_000;
  const balances = allBalances(log, tenantId);
  const lastMovementAt = new Map<string, string>();
  for (const m of log) {
    if (m.tenantId !== tenantId) continue;
    const locs: Array<string | null> = [m.fromLocationId, m.toLocationId];
    for (const loc of locs) {
      if (!loc) continue;
      const key = `${m.skuId}::${loc}`;
      const prev = lastMovementAt.get(key);
      if (!prev || prev < m.occurredAt) lastMovementAt.set(key, m.occurredAt);
    }
  }
  const out: DeadStockItem[] = [];
  for (const bal of balances) {
    if (bal.quantity <= 0) continue;
    const key = `${bal.skuId}::${bal.locationId}`;
    const lastAt = lastMovementAt.get(key) ?? null;
    if (!lastAt) continue;
    const t = Date.parse(lastAt);
    if (t > cutoffMs) continue;
    const daysSince = Math.floor((nowMs - t) / 86_400_000);
    out.push({
      skuId: bal.skuId,
      locationId: bal.locationId,
      onHand: bal.quantity,
      lastMovementAt: lastAt,
      daysSinceMovement: daysSince,
    });
  }
  return out;
}

/**
 * Count distinct (sku, location) pairs that hit zero on-hand within
 * the period.
 */
export function stockOutIncidents(
  log: ReadonlyArray<StockMovement>,
  tenantId: TenantId,
  periodStart: string,
  periodEnd: string,
): { readonly incidents: number; readonly pairs: ReadonlyArray<{ readonly skuId: SkuId; readonly locationId: LocationId }> } {
  const startMs = Date.parse(periodStart);
  const endMs = Date.parse(periodEnd);
  // Per-pair running balance; flag when it transitions from > 0 to 0
  // *during the period*. Use first-pass to seed the balance to its
  // value at periodStart.
  const balance = new Map<string, number>();
  const sorted = [...log]
    .filter((m) => m.tenantId === tenantId)
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  for (const m of sorted) {
    const t = Date.parse(m.occurredAt);
    if (t > endMs) continue;
    if (m.toLocationId) {
      const key = `${m.skuId}::${m.toLocationId}`;
      balance.set(key, (balance.get(key) ?? 0) + m.quantity);
    }
    if (m.fromLocationId) {
      const key = `${m.skuId}::${m.fromLocationId}`;
      balance.set(key, (balance.get(key) ?? 0) - m.quantity);
    }
  }
  // Pass 2: replay only the period to spot zero-cross events.
  const periodBalances = new Map<string, number>();
  // Seed periodBalances with the opening value (movements strictly before periodStart).
  for (const m of sorted) {
    const t = Date.parse(m.occurredAt);
    if (t >= startMs) break;
    if (m.toLocationId) {
      const key = `${m.skuId}::${m.toLocationId}`;
      periodBalances.set(key, (periodBalances.get(key) ?? 0) + m.quantity);
    }
    if (m.fromLocationId) {
      const key = `${m.skuId}::${m.fromLocationId}`;
      periodBalances.set(key, (periodBalances.get(key) ?? 0) - m.quantity);
    }
  }
  const stockedOut = new Set<string>();
  for (const m of sorted) {
    const t = Date.parse(m.occurredAt);
    if (t < startMs || t > endMs) continue;
    if (m.toLocationId) {
      const key = `${m.skuId}::${m.toLocationId}`;
      periodBalances.set(key, (periodBalances.get(key) ?? 0) + m.quantity);
    }
    if (m.fromLocationId) {
      const key = `${m.skuId}::${m.fromLocationId}`;
      const before = periodBalances.get(key) ?? 0;
      const after = before - m.quantity;
      periodBalances.set(key, after);
      if (before > 0 && after <= 0) stockedOut.add(key);
    }
  }
  const pairs = [...stockedOut].map((k) => {
    const [skuId, locationId] = k.split('::') as [SkuId, LocationId];
    return { skuId, locationId };
  });
  return { incidents: pairs.length, pairs };
}

/**
 * Net shrinkage from cycle-count adjustments — aggregates adjustment
 * movements whose reference begins with `cycle-count:`.
 */
export function shrinkageReport(
  log: ReadonlyArray<StockMovement>,
  skus: ReadonlyArray<Sku>,
  tenantId: TenantId,
  periodStart: string,
  periodEnd: string,
): ShrinkageSummary {
  const startMs = Date.parse(periodStart);
  const endMs = Date.parse(periodEnd);
  const skuById = new Map(skus.filter((s) => s.tenantId === tenantId).map((s) => [s.id, s]));
  let totalAdjustmentsValueCents = 0;
  let totalOnHandValueCents = 0;
  const byCount = new Map<CycleCountId, { variances: number; netCents: number }>();
  for (const m of log) {
    if (m.tenantId !== tenantId) continue;
    const t = Date.parse(m.occurredAt);
    if (t < startMs || t > endMs) continue;
    if (m.reason !== 'adjustment') continue;
    const sku = skuById.get(m.skuId);
    if (!sku) continue;
    const sign = m.toLocationId ? 1 : -1;
    const valueCents = sign * m.quantity * sku.defaultUnitCostCents;
    totalAdjustmentsValueCents += valueCents;
    if (m.reference?.startsWith('cycle-count:')) {
      const id = m.reference.slice('cycle-count:'.length);
      const entry = byCount.get(id) ?? { variances: 0, netCents: 0 };
      entry.variances += 1;
      entry.netCents += valueCents;
      byCount.set(id, entry);
    }
  }
  // On-hand value at periodEnd for normalisation.
  for (const sku of skuById.values()) {
    const balances = allBalances(log, tenantId).filter((b) => b.skuId === sku.id);
    for (const b of balances) totalOnHandValueCents += b.quantity * sku.defaultUnitCostCents;
  }
  const netShrinkagePct =
    totalOnHandValueCents > 0
      ? (-totalAdjustmentsValueCents / totalOnHandValueCents) * 100
      : 0;
  return {
    periodStart,
    periodEnd,
    totalAdjustmentsValueCents,
    netShrinkagePct,
    byCycleCountId: [...byCount.entries()].map(([cycleCountId, v]) => ({
      cycleCountId,
      varianceCount: v.variances,
      netValueCents: v.netCents,
    })),
  };
}

/**
 * Top consumption hotspots — (sku, location) pairs by issued quantity
 * within the period. Useful for spotting "which property is burning
 * through paint / bulbs / cleaning supplies".
 */
export function consumptionHotspots(
  log: ReadonlyArray<StockMovement>,
  skus: ReadonlyArray<Sku>,
  tenantId: TenantId,
  periodStart: string,
  periodEnd: string,
  topN = 10,
): ReadonlyArray<ConsumptionHotspot> {
  const startMs = Date.parse(periodStart);
  const endMs = Date.parse(periodEnd);
  const skuById = new Map(skus.filter((s) => s.tenantId === tenantId).map((s) => [s.id, s]));
  const tally = new Map<string, { qty: number; valueCents: number }>();
  for (const m of log) {
    if (m.tenantId !== tenantId) continue;
    if (m.reason !== 'issue' && m.reason !== 'install') continue;
    const t = Date.parse(m.occurredAt);
    if (t < startMs || t > endMs) continue;
    if (!m.fromLocationId) continue;
    const sku = skuById.get(m.skuId);
    if (!sku) continue;
    const key = `${m.skuId}::${m.fromLocationId}`;
    const cur = tally.get(key) ?? { qty: 0, valueCents: 0 };
    cur.qty += m.quantity;
    cur.valueCents += m.quantity * sku.defaultUnitCostCents;
    tally.set(key, cur);
  }
  const out: ConsumptionHotspot[] = [];
  for (const [key, v] of tally) {
    const [skuId, locationId] = key.split('::') as [SkuId, LocationId];
    out.push({ skuId, locationId, issuedQty: v.qty, issuedValueCents: v.valueCents });
  }
  return out.sort((a, b) => b.issuedValueCents - a.issuedValueCents).slice(0, topN);
}
