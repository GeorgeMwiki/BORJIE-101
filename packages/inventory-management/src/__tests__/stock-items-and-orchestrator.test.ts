/**
 * Stock-item view tests + createInventoryManagement orchestrator tests
 * (in-memory store + procurement adapter wired in vs. omitted).
 */

import { describe, it, expect, vi } from 'vitest';
import {
  onHandFor,
  serialsForSku,
  snapshotStockItems,
  totalOnHandForSku,
} from '../items/stock-items.js';
import { receiveStock, transferStock } from '../movements/stock-movements.js';
import {
  createInventoryManagement,
  type InventoryStore,
  type ProcurementAdapter,
} from '../index.js';
import type {
  AssetEvent,
  AssetSerial,
  CycleCount,
  MovementId,
  SkuCategory,
  Sku,
  SkuId,
  StockLocation,
  StockMovement,
} from '../types.js';

const tenantId = 't-1';
const skuId = 'sku-1' as SkuId;
const wA = 'loc-wa';
const wB = 'loc-wb';

function gen(prefix: string) {
  let i = 0;
  return () => `${prefix}-${++i}` as MovementId;
}

describe('snapshotStockItems', () => {
  it('aggregates the movement log into per-(sku, location) rows', () => {
    let log: ReadonlyArray<StockMovement> = [];
    const a = receiveStock(log, tenantId, { skuId, locationId: wA, quantity: 10, condition: 'new' }, gen('m'), '2026-05-01T00:00:00Z');
    if (!a.ok) throw new Error('seed'); log = a.value.log;
    const b = transferStock(log, tenantId, { skuId, fromLocationId: wA, toLocationId: wB, quantity: 3 }, gen('t'), '2026-05-02T00:00:00Z');
    if (!b.ok) throw new Error('seed'); log = b.value.log;
    let i = 0;
    const items = snapshotStockItems(log, tenantId, '2026-05-03T00:00:00Z', () => `it-${++i}`);
    expect(items).toHaveLength(2);
    const a_row = items.find((x) => x.locationId === wA)!;
    const b_row = items.find((x) => x.locationId === wB)!;
    expect(a_row.quantity).toBe(7);
    expect(b_row.quantity).toBe(3);
  });
});

describe('onHandFor + totalOnHandForSku + serialsForSku', () => {
  it('exposes single-pair on-hand + cross-location totals', () => {
    let log: ReadonlyArray<StockMovement> = [];
    const a = receiveStock(log, tenantId, { skuId, locationId: wA, quantity: 10 }, gen('m'), '2026-05-01T00:00:00Z');
    if (!a.ok) throw new Error('seed'); log = a.value.log;
    const b = receiveStock(log, tenantId, { skuId, locationId: wB, quantity: 5 }, gen('m'), '2026-05-02T00:00:00Z');
    if (!b.ok) throw new Error('seed'); log = b.value.log;
    expect(onHandFor(log, tenantId, skuId, wA)).toBe(10);
    expect(totalOnHandForSku(log, tenantId, skuId)).toBe(15);
  });

  it('filters serials by SKU', () => {
    const serials: ReadonlyArray<AssetSerial> = [
      { id: 'a', tenantId, skuId: 'sku-a', serialNumber: '1', status: 'in_stock', currentLocationId: wA, installedInUnitId: null },
      { id: 'b', tenantId, skuId: 'sku-b', serialNumber: '2', status: 'in_stock', currentLocationId: wA, installedInUnitId: null },
    ];
    expect(serialsForSku(serials, tenantId, 'sku-a')).toHaveLength(1);
  });
});

describe('createInventoryManagement orchestrator', () => {
  function makeInMemoryStore(): InventoryStore & {
    readonly skus: Sku[];
    readonly movements: StockMovement[];
  } {
    const skus: Sku[] = [];
    const movements: StockMovement[] = [];
    const categories: SkuCategory[] = [];
    const locations: StockLocation[] = [];
    const assets: AssetSerial[] = [];
    const assetEvents: AssetEvent[] = [];
    const cycleCounts: CycleCount[] = [];
    return {
      skus,
      movements,
      loadSkus: async () => skus,
      loadCategories: async () => categories,
      loadLocations: async () => locations,
      loadMovements: async () => movements,
      loadAssets: async () => assets,
      loadAssetEvents: async () => assetEvents,
      loadCycleCounts: async () => cycleCounts,
      persistSku: async (s) => void skus.push(s),
      persistCategory: async (c) => void categories.push(c),
      persistLocation: async (l) => void locations.push(l),
      persistMovement: async (m) => void movements.push(m),
      persistAsset: async (a) => void assets.push(a),
      persistAssetEvent: async (e) => void assetEvents.push(e),
      persistCycleCount: async (c) => void cycleCounts.push(c),
    };
  }

  it('returns POSpec without procurement when adapter is absent', async () => {
    const store = makeInMemoryStore();
    store.skus.push({
      id: skuId,
      tenantId,
      code: 'C',
      name: 'C',
      categoryId: null,
      unit: 'each',
      defaultUnitCostCents: 100,
      minimumStockLevel: 10,
      reorderQty: 50,
      leadTimeDays: 3,
      isAsset: false,
    });
    const m = createInventoryManagement({ store });
    const r = await m.reorderWithPurchaseOrder(tenantId, { locationId: wA, createDraft: true });
    expect(r.candidates).toHaveLength(1);
    expect(r.specs).toHaveLength(1);
    expect(r.poIds).toHaveLength(0);
    expect(r.procurementAttempted).toBe(false);
  });

  it('hands off to procurement adapter when provided', async () => {
    const store = makeInMemoryStore();
    store.skus.push({
      id: skuId,
      tenantId,
      code: 'C',
      name: 'C',
      categoryId: null,
      unit: 'each',
      defaultUnitCostCents: 100,
      minimumStockLevel: 10,
      reorderQty: 50,
      leadTimeDays: 3,
      isAsset: false,
      supplierVendorIds: ['vendor-1'],
    });
    const proc: ProcurementAdapter = {
      createDraftPO: vi.fn(async () => ({ poId: 'PO-123' })),
    };
    const m = createInventoryManagement({ store, procurement: proc });
    const r = await m.reorderWithPurchaseOrder(tenantId, { locationId: wA, createDraft: true });
    expect(r.procurementAttempted).toBe(true);
    expect(r.poIds).toEqual(['PO-123']);
    expect(proc.createDraftPO).toHaveBeenCalledOnce();
  });

  it('handles procurement adapter failure gracefully', async () => {
    const store = makeInMemoryStore();
    store.skus.push({
      id: skuId,
      tenantId,
      code: 'C',
      name: 'C',
      categoryId: null,
      unit: 'each',
      defaultUnitCostCents: 100,
      minimumStockLevel: 10,
      reorderQty: 50,
      leadTimeDays: 3,
      isAsset: false,
      supplierVendorIds: ['vendor-1'],
    });
    const proc: ProcurementAdapter = {
      createDraftPO: vi.fn(async () => {
        throw new Error('procurement down');
      }),
    };
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const m = createInventoryManagement({ store, procurement: proc });
    const r = await m.reorderWithPurchaseOrder(tenantId, { locationId: wA, createDraft: true });
    expect(r.procurementAttempted).toBe(true);
    expect(r.poIds).toHaveLength(0);
    expect(r.candidates).toHaveLength(1); // candidate still surfaced
    errSpy.mockRestore();
  });
});
