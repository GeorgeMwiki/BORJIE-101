/**
 * Analytics tests — value-on-hand, turnover, dead-stock, stock-outs,
 * shrinkage from cycle-counts, consumption hotspots.
 */

import { describe, it, expect } from 'vitest';
import {
  consumptionHotspots,
  deadStockReport,
  inventoryTurnover,
  shrinkageReport,
  stockOnHandValue,
  stockOutIncidents,
} from '../analytics/inventory-analytics.js';
import {
  adjustStock,
  issueStock,
  receiveStock,
} from '../movements/stock-movements.js';
import type { MovementId, Sku, SkuCategory, SkuId, StockMovement } from '../types.js';

const tenantId = 't-1';
const wA = 'loc-warehouse-a';
const wB = 'loc-warehouse-b';

function gen(prefix: string) {
  let i = 0;
  return () => `${prefix}-${++i}` as MovementId;
}

function makeSku(over: Partial<Sku> & { id: SkuId }): Sku {
  return {
    tenantId,
    code: over.id,
    name: over.id,
    categoryId: null,
    unit: 'each',
    defaultUnitCostCents: 100,
    minimumStockLevel: 0,
    reorderQty: 0,
    leadTimeDays: 0,
    isAsset: false,
    ...over,
  };
}

describe('stockOnHandValue', () => {
  it('values inventory at default unit cost per category', () => {
    const cat: SkuCategory = { id: 'cat-1', tenantId, name: 'Bulbs', parentCategoryId: null };
    const sku = makeSku({ id: 'sku-1' as SkuId, defaultUnitCostCents: 200, categoryId: 'cat-1' });
    const r = receiveStock([], tenantId, { skuId: sku.id, locationId: wA, quantity: 10 }, gen('m'), '2026-05-01T00:00:00Z');
    if (!r.ok) throw new Error('seed');
    const snap = stockOnHandValue([sku], [cat], r.value.log, tenantId, wA, '2026-05-02T00:00:00Z');
    expect(snap.totalValueCents).toBe(10 * 200);
    expect(snap.byCategoryValueCents['Bulbs']).toBe(2000);
  });

  it('aggregates across all locations when locationId is null', () => {
    const sku = makeSku({ id: 'sku-1' as SkuId, defaultUnitCostCents: 200 });
    let log: ReadonlyArray<StockMovement> = [];
    const a = receiveStock(log, tenantId, { skuId: sku.id, locationId: wA, quantity: 10 }, gen('m'), '2026-05-01T00:00:00Z');
    if (!a.ok) throw new Error('seed'); log = a.value.log;
    const b = receiveStock(log, tenantId, { skuId: sku.id, locationId: wB, quantity: 5 }, gen('m'), '2026-05-01T00:00:00Z');
    if (!b.ok) throw new Error('seed'); log = b.value.log;
    const snap = stockOnHandValue([sku], [], log, tenantId, null, '2026-05-02T00:00:00Z');
    expect(snap.totalValueCents).toBe(15 * 200);
    expect(snap.byCategoryValueCents['Uncategorised']).toBe(3000);
  });
});

describe('inventoryTurnover', () => {
  it('computes issuedQty / avgOnHand for a period', () => {
    const sku = makeSku({ id: 'sku-1' as SkuId });
    let log: ReadonlyArray<StockMovement> = [];
    const r0 = receiveStock(log, tenantId, { skuId: sku.id, locationId: wA, quantity: 100 }, gen('m'), '2026-04-01T00:00:00Z');
    if (!r0.ok) throw new Error('seed'); log = r0.value.log;
    const r1 = issueStock(log, tenantId, { skuId: sku.id, fromLocationId: wA, quantity: 40 }, gen('i'), '2026-05-10T00:00:00Z');
    if (!r1.ok) throw new Error('seed'); log = r1.value.log;
    const r2 = issueStock(log, tenantId, { skuId: sku.id, fromLocationId: wA, quantity: 20 }, gen('i'), '2026-05-20T00:00:00Z');
    if (!r2.ok) throw new Error('seed'); log = r2.value.log;
    const t = inventoryTurnover(log, tenantId, sku.id, '2026-05-01T00:00:00Z', '2026-05-31T23:59:59Z');
    expect(t.issuedQty).toBe(60);
    expect(t.turnover).toBeGreaterThan(0);
  });
});

describe('deadStockReport', () => {
  it('flags SKU+location pairs that have not moved in N days', () => {
    const r = receiveStock([], tenantId, { skuId: 'sku-1' as SkuId, locationId: wA, quantity: 10 }, gen('m'), '2025-01-01T00:00:00Z');
    if (!r.ok) throw new Error('seed');
    const dead = deadStockReport(r.value.log, tenantId, '2026-05-01T00:00:00Z', 180);
    expect(dead).toHaveLength(1);
    expect(dead[0]!.daysSinceMovement).toBeGreaterThanOrEqual(180);
  });

  it('does not flag freshly moved stock', () => {
    const r = receiveStock([], tenantId, { skuId: 'sku-1' as SkuId, locationId: wA, quantity: 10 }, gen('m'), '2026-05-01T00:00:00Z');
    if (!r.ok) throw new Error('seed');
    const dead = deadStockReport(r.value.log, tenantId, '2026-05-02T00:00:00Z', 180);
    expect(dead).toHaveLength(0);
  });
});

describe('stockOutIncidents', () => {
  it('detects when on-hand crosses zero within the period', () => {
    let log: ReadonlyArray<StockMovement> = [];
    const a = receiveStock(log, tenantId, { skuId: 'sku-1' as SkuId, locationId: wA, quantity: 5 }, gen('m'), '2026-05-01T00:00:00Z');
    if (!a.ok) throw new Error('seed'); log = a.value.log;
    const b = issueStock(log, tenantId, { skuId: 'sku-1' as SkuId, fromLocationId: wA, quantity: 5 }, gen('i'), '2026-05-15T00:00:00Z');
    if (!b.ok) throw new Error('seed'); log = b.value.log;
    const out = stockOutIncidents(log, tenantId, '2026-05-01T00:00:00Z', '2026-05-31T00:00:00Z');
    expect(out.incidents).toBe(1);
  });

  it('does not count stock-outs from before the period', () => {
    let log: ReadonlyArray<StockMovement> = [];
    const a = receiveStock(log, tenantId, { skuId: 'sku-1' as SkuId, locationId: wA, quantity: 5 }, gen('m'), '2026-04-01T00:00:00Z');
    if (!a.ok) throw new Error('seed'); log = a.value.log;
    const b = issueStock(log, tenantId, { skuId: 'sku-1' as SkuId, fromLocationId: wA, quantity: 5 }, gen('i'), '2026-04-10T00:00:00Z');
    if (!b.ok) throw new Error('seed'); log = b.value.log;
    const out = stockOutIncidents(log, tenantId, '2026-05-01T00:00:00Z', '2026-05-31T00:00:00Z');
    expect(out.incidents).toBe(0);
  });
});

describe('shrinkageReport', () => {
  it('aggregates negative cycle-count adjustments', () => {
    const sku = makeSku({ id: 'sku-1' as SkuId, defaultUnitCostCents: 100 });
    let log: ReadonlyArray<StockMovement> = [];
    const a = receiveStock(log, tenantId, { skuId: sku.id, locationId: wA, quantity: 100 }, gen('m'), '2026-05-01T00:00:00Z');
    if (!a.ok) throw new Error('seed'); log = a.value.log;
    const adj = adjustStock(log, tenantId, { skuId: sku.id, locationId: wA, delta: -5, reference: 'cycle-count:cc-77', reason: 'loss' }, gen('a'), '2026-05-15T00:00:00Z');
    if (!adj.ok) throw new Error('adj'); log = adj.value.log;
    const r = shrinkageReport(log, [sku], tenantId, '2026-05-01T00:00:00Z', '2026-05-31T00:00:00Z');
    expect(r.totalAdjustmentsValueCents).toBe(-500); // 5 units × 100c lost
    expect(r.byCycleCountId).toHaveLength(1);
    expect(r.byCycleCountId[0]!.cycleCountId).toBe('cc-77');
  });
});

describe('consumptionHotspots', () => {
  it('sorts top-N by issued value', () => {
    const sku1 = makeSku({ id: 'sku-paint' as SkuId, defaultUnitCostCents: 1500 });
    const sku2 = makeSku({ id: 'sku-bulb' as SkuId, defaultUnitCostCents: 200 });
    let log: ReadonlyArray<StockMovement> = [];
    const a = receiveStock(log, tenantId, { skuId: sku1.id, locationId: wA, quantity: 50 }, gen('m'), '2026-05-01T00:00:00Z');
    if (!a.ok) throw new Error('seed'); log = a.value.log;
    const b = receiveStock(log, tenantId, { skuId: sku2.id, locationId: wB, quantity: 100 }, gen('m'), '2026-05-01T00:00:00Z');
    if (!b.ok) throw new Error('seed'); log = b.value.log;
    const c = issueStock(log, tenantId, { skuId: sku1.id, fromLocationId: wA, quantity: 10 }, gen('i'), '2026-05-15T00:00:00Z');
    if (!c.ok) throw new Error('seed'); log = c.value.log;
    const d = issueStock(log, tenantId, { skuId: sku2.id, fromLocationId: wB, quantity: 50 }, gen('i'), '2026-05-16T00:00:00Z');
    if (!d.ok) throw new Error('seed'); log = d.value.log;
    const hot = consumptionHotspots(log, [sku1, sku2], tenantId, '2026-05-01T00:00:00Z', '2026-05-31T00:00:00Z');
    expect(hot).toHaveLength(2);
    // Paint = 10 * 1500c = 15_000c > Bulb = 50 * 200c = 10_000c.
    expect(hot[0]!.skuId).toBe('sku-paint');
    expect(hot[0]!.issuedValueCents).toBe(15_000);
  });
});
