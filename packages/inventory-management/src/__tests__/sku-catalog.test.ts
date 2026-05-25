/**
 * SKU catalog tests — CRUD, immutability, duplicates, bulk-import,
 * category tree.
 */

import { describe, it, expect } from 'vitest';
import {
  archiveSku,
  buildCategoryTree,
  bulkImportSkus,
  createCategory,
  createSku,
  findSku,
  findSkuByCode,
  listSkus,
  updateSku,
  type SkuDraft,
} from '../sku/sku-catalog.js';
import type { Sku, SkuCategory, SkuId } from '../types.js';

const tenantId = 't-1';
const makeId = (prefix: string) => {
  let i = 0;
  return () => `${prefix}-${++i}` as SkuId;
};

const baseDraft: SkuDraft = {
  code: 'BULB-LED-9W',
  name: 'LED bulb 9W warm white',
  categoryId: null,
  unit: 'each',
  defaultUnitCostCents: 250,
  minimumStockLevel: 50,
  reorderQty: 200,
  leadTimeDays: 7,
  isAsset: false,
};

describe('createSku', () => {
  it('creates a SKU and returns a new catalog (no mutation)', () => {
    const catalog: ReadonlyArray<Sku> = [];
    const r = createSku(catalog, tenantId, baseDraft, makeId('sku'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.sku.code).toBe('BULB-LED-9W');
    expect(r.value.sku.tenantId).toBe(tenantId);
    expect(r.value.catalog).toHaveLength(1);
    expect(catalog).toHaveLength(0); // immutable
  });

  it('rejects an empty code via Zod', () => {
    const r = createSku([], tenantId, { ...baseDraft, code: '' }, makeId('sku'));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('BAD_REQUEST');
  });

  it('rejects a duplicate code per tenant', () => {
    const first = createSku([], tenantId, baseDraft, makeId('sku'));
    if (!first.ok) throw new Error('seed failed');
    const r = createSku(first.value.catalog, tenantId, baseDraft, makeId('sku'));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('DUPLICATE_CODE');
  });

  it('allows the same code in a different tenant', () => {
    const first = createSku([], tenantId, baseDraft, makeId('sku'));
    if (!first.ok) throw new Error('seed failed');
    const r = createSku(first.value.catalog, 't-2', baseDraft, makeId('sku'));
    expect(r.ok).toBe(true);
  });

  it('rejects an invalid unit', () => {
    const r = createSku([], tenantId, { ...baseDraft, unit: 'gallons' as any }, makeId('sku'));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('BAD_REQUEST');
  });
});

describe('updateSku', () => {
  it('patches fields immutably', () => {
    const seed = createSku([], tenantId, baseDraft, makeId('sku'));
    if (!seed.ok) throw new Error('seed failed');
    const r = updateSku(seed.value.catalog, tenantId, seed.value.sku.id, { minimumStockLevel: 100 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.sku.minimumStockLevel).toBe(100);
    expect(r.value.sku.code).toBe('BULB-LED-9W');
    expect(seed.value.sku.minimumStockLevel).toBe(50); // original unchanged
  });

  it('refuses cross-tenant updates', () => {
    const seed = createSku([], tenantId, baseDraft, makeId('sku'));
    if (!seed.ok) throw new Error('seed failed');
    const r = updateSku(seed.value.catalog, 't-attacker', seed.value.sku.id, { minimumStockLevel: 0 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('TENANT_MISMATCH');
  });

  it('returns NOT_FOUND for unknown id', () => {
    const r = updateSku([], tenantId, 'no-such-sku', {});
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('NOT_FOUND');
  });
});

describe('archiveSku + listSkus', () => {
  it('archives without removing and respects includeArchived', () => {
    const seed = createSku([], tenantId, baseDraft, makeId('sku'));
    if (!seed.ok) throw new Error('seed failed');
    const archived = archiveSku(seed.value.catalog, tenantId, seed.value.sku.id, '2026-01-01T00:00:00Z');
    expect(archived.ok).toBe(true);
    if (!archived.ok) return;
    expect(listSkus(archived.value, tenantId)).toHaveLength(0);
    expect(listSkus(archived.value, tenantId, { includeArchived: true })).toHaveLength(1);
  });
});

describe('findSku + findSkuByCode', () => {
  it('finds by id and by code, but not across tenants', () => {
    const seed = createSku([], tenantId, baseDraft, makeId('sku'));
    if (!seed.ok) throw new Error('seed failed');
    expect(findSku(seed.value.catalog, tenantId, seed.value.sku.id)).toBeTruthy();
    expect(findSku(seed.value.catalog, 'other', seed.value.sku.id)).toBeNull();
    expect(findSkuByCode(seed.value.catalog, tenantId, 'BULB-LED-9W')).toBeTruthy();
    expect(findSkuByCode(seed.value.catalog, tenantId, 'nope')).toBeNull();
  });
});

describe('bulkImportSkus', () => {
  it('imports valid rows, normalises unit aliases, reports per-row errors', () => {
    const r = bulkImportSkus(
      [],
      tenantId,
      [
        { code: 'PAINT-WHITE-5L', name: 'White emulsion 5L', unit: 'liter', minimumStockLevel: 5, reorderQty: 20, leadTimeDays: 14 },
        { code: 'GLOVES-NTR-M', name: 'Nitrile gloves M', unit: 'box', minimumStockLevel: 10, reorderQty: 50, leadTimeDays: 3 },
        { code: 'NOPE', name: 'Bad row', unit: 'lightyears' },         // unknown unit
        { code: '', name: 'Empty code', unit: 'each' },                  // empty code
      ],
      makeId('sku'),
    );
    expect(r.created).toHaveLength(2);
    expect(r.errors).toHaveLength(2);
    expect(r.catalog).toHaveLength(2);
    expect(r.created[0]!.unit).toBe('L');
  });

  it('rejects duplicate codes within a single import', () => {
    const r = bulkImportSkus(
      [],
      tenantId,
      [
        { code: 'X', name: 'first', unit: 'each' },
        { code: 'X', name: 'second', unit: 'each' },
      ],
      makeId('sku'),
    );
    expect(r.created).toHaveLength(1);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]!.message).toMatch(/already exists/);
  });
});

describe('categories', () => {
  it('builds a parent/child tree', () => {
    let tree: ReadonlyArray<SkuCategory> = [];
    let id = 0;
    const gen = () => `cat-${++id}`;
    const root = createCategory(tree, tenantId, 'Cleaning', null, gen);
    if (!root.ok) throw new Error('seed failed');
    tree = root.value.tree;
    const child = createCategory(tree, tenantId, 'Detergents', root.value.category.id, gen);
    if (!child.ok) throw new Error('seed failed');
    tree = child.value.tree;
    const built = buildCategoryTree(tree, tenantId);
    expect(built).toHaveLength(1);
    expect(built[0]!.category.name).toBe('Cleaning');
    expect(built[0]!.children).toHaveLength(1);
    expect(built[0]!.children[0]!.category.name).toBe('Detergents');
  });

  it('rejects a non-existent parent', () => {
    const r = createCategory([], tenantId, 'Orphan', 'nonexistent', () => 'cat-x');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('BAD_REQUEST');
  });

  it('rejects an empty name', () => {
    const r = createCategory([], tenantId, '', null, () => 'cat-x');
    expect(r.ok).toBe(false);
  });
});
