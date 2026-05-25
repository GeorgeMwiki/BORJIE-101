/**
 * Reorder engine tests — threshold detection, ABC banding, PO grouping
 * by vendor, forecast-based projection of next reorder date.
 */

import { describe, it, expect } from 'vitest';
import {
  abcBand,
  forecastReorderDate,
  reorderCandidates,
  suggestPurchaseOrder,
} from '../reorder/reorder-engine.js';
import { receiveStock, issueStock } from '../movements/stock-movements.js';
import type { MovementId, Sku, SkuId, StockMovement } from '../types.js';

const tenantId = 't-1';
const wA = 'loc-warehouse-a';

function makeSku(over: Partial<Sku>): Sku {
  return {
    id: 'sku-1' as SkuId,
    tenantId,
    code: 'X',
    name: 'X',
    categoryId: null,
    unit: 'each',
    defaultUnitCostCents: 100,
    minimumStockLevel: 10,
    reorderQty: 100,
    leadTimeDays: 7,
    isAsset: false,
    ...over,
  };
}

function gen(prefix: string) {
  let i = 0;
  return () => `${prefix}-${++i}` as MovementId;
}

describe('reorderCandidates', () => {
  it('flags SKUs at or below minimum stock', () => {
    const sku = makeSku({ id: 'sku-bulb' as SkuId, minimumStockLevel: 50, reorderQty: 200, defaultUnitCostCents: 200 });
    const seed = receiveStock([], tenantId, { skuId: sku.id, locationId: wA, quantity: 30 }, gen('m'), '2026-05-01T00:00:00Z');
    if (!seed.ok) throw new Error('seed');
    const cands = reorderCandidates([sku], seed.value.log, tenantId, { locationId: wA });
    expect(cands).toHaveLength(1);
    expect(cands[0]!.onHand).toBe(30);
    expect(cands[0]!.shortfall).toBe(20);
    expect(cands[0]!.suggestedQty).toBeGreaterThanOrEqual(200);
  });

  it('does NOT flag SKUs above minimum', () => {
    const sku = makeSku({ id: 'sku-bulb' as SkuId, minimumStockLevel: 5 });
    const seed = receiveStock([], tenantId, { skuId: sku.id, locationId: wA, quantity: 30 }, gen('m'), '2026-05-01T00:00:00Z');
    if (!seed.ok) throw new Error('seed');
    expect(reorderCandidates([sku], seed.value.log, tenantId, { locationId: wA })).toHaveLength(0);
  });

  it('flags SKUs with zero stock as candidates', () => {
    const sku = makeSku({ id: 'sku-bulb' as SkuId, minimumStockLevel: 10 });
    const cands = reorderCandidates([sku], [], tenantId, { locationId: wA });
    expect(cands).toHaveLength(1);
    expect(cands[0]!.shortfall).toBe(10);
  });

  it('aggregates across all locations when no locationId is supplied', () => {
    const sku = makeSku({ id: 'sku-bulb' as SkuId, minimumStockLevel: 20 });
    const r1 = receiveStock([], tenantId, { skuId: sku.id, locationId: wA, quantity: 5 }, gen('m'), '2026-05-01T00:00:00Z');
    if (!r1.ok) throw new Error('seed');
    const r2 = receiveStock(r1.value.log, tenantId, { skuId: sku.id, locationId: 'loc-b', quantity: 5 }, gen('m'), '2026-05-02T00:00:00Z');
    if (!r2.ok) throw new Error('seed');
    const cands = reorderCandidates([sku], r2.value.log, tenantId, {});
    expect(cands).toHaveLength(1);
    expect(cands[0]!.onHand).toBe(10);
  });
});

describe('abcBand', () => {
  it('assigns A band to top 80% of cumulative value', () => {
    const bands = abcBand([
      { skuId: 'a', valueCents: 800 },
      { skuId: 'b', valueCents: 100 },
      { skuId: 'c', valueCents: 60 },
      { skuId: 'd', valueCents: 40 },
    ]);
    expect(bands.find((b) => b.skuId === 'a')?.band).toBe('A');
    expect(bands.find((b) => b.skuId === 'b')?.band).toBe('B');
    expect(bands.find((b) => b.skuId === 'd')?.band).toBe('C');
  });

  it('returns C-band for all-zero values', () => {
    const bands = abcBand([
      { skuId: 'a', valueCents: 0 },
      { skuId: 'b', valueCents: 0 },
    ]);
    expect(bands.every((b) => b.band === 'C')).toBe(true);
  });
});

describe('suggestPurchaseOrder', () => {
  it('groups candidates by vendor', () => {
    const skuA = makeSku({ id: 'sku-a' as SkuId, supplierVendorIds: ['vendor-1'] });
    const skuB = makeSku({ id: 'sku-b' as SkuId, supplierVendorIds: ['vendor-1'] });
    const skuC = makeSku({ id: 'sku-c' as SkuId, supplierVendorIds: ['vendor-2'] });
    const skuD = makeSku({ id: 'sku-d' as SkuId });   // no vendor
    const cands = [
      { skuId: 'sku-a', locationId: wA, onHand: 0, minimumStockLevel: 10, shortfall: 10, suggestedQty: 100, leadTimeDays: 7, defaultUnitCostCents: 100, abcBand: 'A' as const },
      { skuId: 'sku-b', locationId: wA, onHand: 0, minimumStockLevel: 10, shortfall: 10, suggestedQty: 50, leadTimeDays: 7, defaultUnitCostCents: 100, abcBand: 'A' as const },
      { skuId: 'sku-c', locationId: wA, onHand: 0, minimumStockLevel: 10, shortfall: 10, suggestedQty: 100, leadTimeDays: 7, defaultUnitCostCents: 100, abcBand: 'A' as const },
      { skuId: 'sku-d', locationId: wA, onHand: 0, minimumStockLevel: 10, shortfall: 10, suggestedQty: 100, leadTimeDays: 7, defaultUnitCostCents: 100, abcBand: 'A' as const },
    ];
    const specs = suggestPurchaseOrder(cands, [skuA, skuB, skuC, skuD], tenantId);
    expect(specs).toHaveLength(3);
    const v1 = specs.find((s) => s.vendorId === 'vendor-1');
    expect(v1?.lines).toHaveLength(2);
    expect(v1?.subtotalCents).toBe(100 * 100 + 50 * 100);
    expect(specs.find((s) => s.vendorId === 'unassigned')).toBeTruthy();
  });
});

describe('forecastReorderDate', () => {
  it('projects when on-hand will hit minimum at observed burn rate', () => {
    const skuId = 'sku-bulb' as SkuId;
    const minStock = 0;
    // Receive 200 then issue 20 a week ago, then 20 today — 40 over 7 days ≈ ~5.7/day.
    let log: ReadonlyArray<StockMovement> = [];
    const a = receiveStock(log, tenantId, { skuId, locationId: wA, quantity: 200 }, gen('m'), '2026-04-01T00:00:00Z');
    if (!a.ok) throw new Error('seed'); log = a.value.log;
    const b = issueStock(log, tenantId, { skuId, fromLocationId: wA, quantity: 20 }, gen('i'), '2026-05-15T00:00:00Z');
    if (!b.ok) throw new Error('seed'); log = b.value.log;
    const c = issueStock(log, tenantId, { skuId, fromLocationId: wA, quantity: 20 }, gen('i'), '2026-05-21T00:00:00Z');
    if (!c.ok) throw new Error('seed'); log = c.value.log;
    const forecast = forecastReorderDate(skuId, log, tenantId, wA, '2026-05-22T00:00:00Z', { minimumStockLevel: minStock, lookbackDays: 30 });
    expect(forecast).not.toBeNull();
    expect(forecast!.issuedPerDay).toBeGreaterThan(0);
    expect(forecast!.daysUntilReorder).toBeGreaterThan(0);
  });

  it('returns null when there is no consumption history', () => {
    const a = receiveStock([], tenantId, { skuId: 'sku-bulb', locationId: wA, quantity: 200 }, gen('m'), '2026-04-01T00:00:00Z');
    if (!a.ok) throw new Error('seed');
    expect(
      forecastReorderDate('sku-bulb', a.value.log, tenantId, wA, '2026-05-22T00:00:00Z', { minimumStockLevel: 0 }),
    ).toBeNull();
  });
});
