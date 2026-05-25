/**
 * Reorder + replenishment.
 *
 *  - `reorderCandidates(location)` — SKUs at or below `minimumStockLevel`.
 *  - `suggestPurchaseOrder(candidates)` — groups by vendor, returns
 *    `POSpec` drafts. When a `procurement` adapter is supplied at the
 *    package surface, the orchestrator can hand the spec off to the
 *    purchase-order workflow; here we just return the structured spec.
 *  - `abcBand(values)` — Pareto-band SKUs A (top 80% of value) / B
 *    (next 15%) / C (bottom 5%) for prioritised replenishment.
 *  - `forecastReorderDate` — rolling 30-day consumption rate projected
 *    against current on-hand + lead-time.
 */

import {
  type LocationId,
  type POSpec,
  type POSpecLine,
  type ReorderCandidate,
  type Sku,
  type SkuId,
  type StockMovement,
  type TenantId,
  type VendorId,
} from '../types.js';
import { currentStock } from '../movements/stock-movements.js';

export interface ReorderCandidateOptions {
  readonly locationId?: LocationId;
}

/**
 * Compute reorder candidates. When `locationId` is omitted, evaluates
 * the SKU's *total* on-hand across all locations against its minimum.
 * When set, evaluates per-location stock (recommended for warehouses
 * that maintain independent par-levels).
 */
export function reorderCandidates(
  skus: ReadonlyArray<Sku>,
  log: ReadonlyArray<StockMovement>,
  tenantId: TenantId,
  options: ReorderCandidateOptions = {},
): ReadonlyArray<ReorderCandidate> {
  const scopedSkus = skus.filter((s) => s.tenantId === tenantId && !s.archivedAt);
  // First pass — compute on-hand + value for ABC bands.
  const onHandValuesCents: Array<{ skuId: SkuId; locationId: LocationId | null; onHand: number; valueCents: number }> = [];
  for (const sku of scopedSkus) {
    if (options.locationId) {
      const onHand = currentStock(log, tenantId, sku.id, options.locationId);
      onHandValuesCents.push({
        skuId: sku.id,
        locationId: options.locationId,
        onHand,
        valueCents: onHand * sku.defaultUnitCostCents,
      });
    } else {
      // Aggregate across locations.
      let onHand = 0;
      for (const m of log) {
        if (m.tenantId !== tenantId) continue;
        if (m.skuId !== sku.id) continue;
        if (m.toLocationId) onHand += m.quantity;
        if (m.fromLocationId) onHand -= m.quantity;
      }
      onHandValuesCents.push({
        skuId: sku.id,
        locationId: null,
        onHand,
        valueCents: onHand * sku.defaultUnitCostCents,
      });
    }
  }
  const bands = abcBand(onHandValuesCents.map((r) => ({ skuId: r.skuId, valueCents: r.valueCents })));
  const bandLookup = new Map(bands.map((b) => [b.skuId, b.band]));

  const out: ReorderCandidate[] = [];
  for (const sku of scopedSkus) {
    const stockRow = onHandValuesCents.find((r) => r.skuId === sku.id);
    if (!stockRow) continue;
    if (stockRow.onHand > sku.minimumStockLevel) continue;
    const shortfall = Math.max(0, sku.minimumStockLevel - stockRow.onHand);
    const suggestedQty = Math.max(sku.reorderQty, shortfall);
    out.push({
      skuId: sku.id,
      locationId: stockRow.locationId ?? '',
      onHand: stockRow.onHand,
      minimumStockLevel: sku.minimumStockLevel,
      shortfall,
      suggestedQty,
      leadTimeDays: sku.leadTimeDays,
      defaultUnitCostCents: sku.defaultUnitCostCents,
      abcBand: bandLookup.get(sku.id) ?? 'C',
    });
  }
  return out;
}

/**
 * ABC analysis — Pareto-band SKUs by value contribution.
 *
 * A = top 80% of cumulative value, B = next 15%, C = remainder.
 * Stable for ties (insertion order preserved within bands).
 */
export function abcBand(
  rows: ReadonlyArray<{ readonly skuId: SkuId; readonly valueCents: number }>,
): ReadonlyArray<{ readonly skuId: SkuId; readonly band: 'A' | 'B' | 'C' }> {
  const sorted = [...rows].sort((a, b) => b.valueCents - a.valueCents);
  const total = sorted.reduce((acc, r) => acc + r.valueCents, 0);
  if (total <= 0) {
    return sorted.map((r) => ({ skuId: r.skuId, band: 'C' as const }));
  }
  let running = 0;
  const out: Array<{ skuId: SkuId; band: 'A' | 'B' | 'C' }> = [];
  for (const r of sorted) {
    running += r.valueCents;
    const pct = running / total;
    const band: 'A' | 'B' | 'C' = pct <= 0.8 ? 'A' : pct <= 0.95 ? 'B' : 'C';
    out.push({ skuId: r.skuId, band });
  }
  return out;
}

/**
 * Group reorder candidates into per-vendor POSpec drafts. When a SKU
 * has multiple `supplierVendorIds`, the FIRST is selected — the
 * procurement-coordination module can re-rank by vendor health later.
 * SKUs with no vendor end up under `vendorId: 'unassigned'`.
 */
export function suggestPurchaseOrder(
  candidates: ReadonlyArray<ReorderCandidate>,
  skus: ReadonlyArray<Sku>,
  tenantId: TenantId,
): ReadonlyArray<POSpec> {
  const skuById = new Map(skus.map((s) => [s.id, s]));
  const byVendor = new Map<VendorId | 'unassigned', POSpecLine[]>();
  for (const cand of candidates) {
    const sku = skuById.get(cand.skuId);
    if (!sku) continue;
    const vendorId = (sku.supplierVendorIds?.[0] as VendorId | undefined) ?? 'unassigned';
    const line: POSpecLine = {
      skuId: cand.skuId,
      quantity: cand.suggestedQty,
      unitCostCents: cand.defaultUnitCostCents,
    };
    const list = byVendor.get(vendorId) ?? [];
    list.push(line);
    byVendor.set(vendorId, list);
  }
  const out: POSpec[] = [];
  for (const [vendorId, lines] of byVendor) {
    const subtotalCents = lines.reduce((acc, l) => acc + l.quantity * l.unitCostCents, 0);
    out.push({ tenantId, vendorId, lines, subtotalCents });
  }
  return out;
}

/**
 * Forecast-based replenishment — rolling consumption rate (issued qty
 * per day over the lookback window) → predicted days until on-hand
 * reaches reorder point.
 *
 * Returns `null` when there has been no consumption (cannot project).
 */
export function forecastReorderDate(
  skuId: SkuId,
  log: ReadonlyArray<StockMovement>,
  tenantId: TenantId,
  locationId: LocationId,
  now: string,
  options: { readonly lookbackDays?: number; readonly minimumStockLevel: number } = { minimumStockLevel: 0 },
): { readonly daysUntilReorder: number; readonly issuedPerDay: number; readonly projectedDate: string } | null {
  const lookback = options.lookbackDays ?? 30;
  const nowMs = Date.parse(now);
  const cutoffMs = nowMs - lookback * 86_400_000;
  let issued = 0;
  for (const m of log) {
    if (m.tenantId !== tenantId) continue;
    if (m.skuId !== skuId) continue;
    if (m.fromLocationId !== locationId) continue;
    if (m.reason !== 'issue' && m.reason !== 'install') continue;
    const t = Date.parse(m.occurredAt);
    if (!Number.isFinite(t) || t < cutoffMs) continue;
    issued += m.quantity;
  }
  if (issued <= 0) return null;
  const issuedPerDay = issued / lookback;
  const onHand = currentStock(log, tenantId, skuId, locationId);
  const burnable = Math.max(0, onHand - options.minimumStockLevel);
  const daysUntilReorder = Math.floor(burnable / issuedPerDay);
  const projectedDateMs = nowMs + daysUntilReorder * 86_400_000;
  return {
    daysUntilReorder,
    issuedPerDay,
    projectedDate: new Date(projectedDateMs).toISOString(),
  };
}
