/**
 * SKU + category catalog — in-memory pure functions over `Sku` records.
 *
 * Persistence is pushed to an injectable port at the package surface
 * (`createInventoryManagement`). These functions take the current
 * collection in, return a new collection out — never mutate.
 *
 * Bulk-import normalisation: a CSV row arrives loosely typed; we
 * validate + coerce + reject on duplicate `code` per tenant.
 */

import { z } from 'zod';
import {
  err,
  ok,
  SKU_UNITS,
  type Result,
  type Sku,
  type SkuCategory,
  type SkuId,
  type SkuImportRow,
  type SkuUnit,
  type TenantId,
} from '../types.js';

// ─────────────────────────────────────────────────────────────────────
// Zod schemas — bulk-import row + sku draft
// ─────────────────────────────────────────────────────────────────────

const SkuUnitSchema = z.enum(SKU_UNITS);

export const SkuImportRowSchema = z.object({
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
  unit: z.string().min(1),
  defaultUnitCostCents: z.number().int().nonnegative().optional(),
  minimumStockLevel: z.number().int().nonnegative().optional(),
  reorderQty: z.number().int().nonnegative().optional(),
  leadTimeDays: z.number().int().nonnegative().optional(),
  isAsset: z.boolean().optional(),
  category: z.string().max(120).optional(),
  description: z.string().max(2000).optional(),
  barcode: z.string().max(120).optional(),
});

export const SkuDraftSchema = z.object({
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  categoryId: z.string().nullable(),
  unit: SkuUnitSchema,
  defaultUnitCostCents: z.number().int().nonnegative(),
  minimumStockLevel: z.number().int().nonnegative(),
  reorderQty: z.number().int().nonnegative(),
  leadTimeDays: z.number().int().nonnegative(),
  isAsset: z.boolean(),
  images: z.array(z.string()).optional(),
  barcode: z.string().max(120).optional(),
  qrCode: z.string().max(500).optional(),
  supplierVendorIds: z.array(z.string()).optional(),
});

export type SkuDraft = z.infer<typeof SkuDraftSchema>;

// ─────────────────────────────────────────────────────────────────────
// CRUD helpers — pure, immutable
// ─────────────────────────────────────────────────────────────────────

export function createSku(
  existing: ReadonlyArray<Sku>,
  tenantId: TenantId,
  draft: SkuDraft,
  idGen: () => SkuId,
): Result<{ readonly sku: Sku; readonly catalog: ReadonlyArray<Sku> }, 'DUPLICATE_CODE' | 'BAD_REQUEST'> {
  const parsed = SkuDraftSchema.safeParse(draft);
  if (!parsed.success) return err('BAD_REQUEST', parsed.error.message);
  const dup = existing.find(
    (s) => s.tenantId === tenantId && s.code === parsed.data.code && !s.archivedAt,
  );
  if (dup) return err('DUPLICATE_CODE', `SKU code "${parsed.data.code}" already exists`);
  const sku: Sku = {
    id: idGen(),
    tenantId,
    code: parsed.data.code,
    name: parsed.data.name,
    ...(parsed.data.description !== undefined && { description: parsed.data.description }),
    categoryId: parsed.data.categoryId,
    unit: parsed.data.unit,
    defaultUnitCostCents: parsed.data.defaultUnitCostCents,
    minimumStockLevel: parsed.data.minimumStockLevel,
    reorderQty: parsed.data.reorderQty,
    leadTimeDays: parsed.data.leadTimeDays,
    isAsset: parsed.data.isAsset,
    ...(parsed.data.images !== undefined && { images: parsed.data.images }),
    ...(parsed.data.barcode !== undefined && { barcode: parsed.data.barcode }),
    ...(parsed.data.qrCode !== undefined && { qrCode: parsed.data.qrCode }),
    ...(parsed.data.supplierVendorIds !== undefined && { supplierVendorIds: parsed.data.supplierVendorIds }),
  };
  return ok({ sku, catalog: [...existing, sku] });
}

export function updateSku(
  existing: ReadonlyArray<Sku>,
  tenantId: TenantId,
  skuId: SkuId,
  patch: Partial<SkuDraft>,
): Result<{ readonly sku: Sku; readonly catalog: ReadonlyArray<Sku> }, 'NOT_FOUND' | 'TENANT_MISMATCH'> {
  const idx = existing.findIndex((s) => s.id === skuId);
  if (idx < 0) return err('NOT_FOUND', `SKU ${skuId} not found`);
  const current = existing[idx]!;
  if (current.tenantId !== tenantId) return err('TENANT_MISMATCH', 'cross-tenant SKU access denied');
  // Strip `undefined` patch keys so exactOptionalPropertyTypes is satisfied.
  const cleaned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined) cleaned[k] = v;
  }
  const next: Sku = { ...current, ...(cleaned as Partial<Sku>) };
  const catalog = [...existing.slice(0, idx), next, ...existing.slice(idx + 1)];
  return ok({ sku: next, catalog });
}

export function archiveSku(
  existing: ReadonlyArray<Sku>,
  tenantId: TenantId,
  skuId: SkuId,
  now: string,
): Result<ReadonlyArray<Sku>, 'NOT_FOUND' | 'TENANT_MISMATCH'> {
  const result = updateSku(existing, tenantId, skuId, { /* placeholder */ } as Partial<SkuDraft>);
  if (!result.ok) return result;
  const archived: Sku = { ...result.value.sku, archivedAt: now };
  const idx = result.value.catalog.findIndex((s) => s.id === skuId);
  const catalog = [
    ...result.value.catalog.slice(0, idx),
    archived,
    ...result.value.catalog.slice(idx + 1),
  ];
  return ok(catalog);
}

export function findSku(
  catalog: ReadonlyArray<Sku>,
  tenantId: TenantId,
  skuId: SkuId,
): Sku | null {
  const s = catalog.find((x) => x.id === skuId);
  if (!s || s.tenantId !== tenantId) return null;
  return s;
}

export function findSkuByCode(
  catalog: ReadonlyArray<Sku>,
  tenantId: TenantId,
  code: string,
): Sku | null {
  return (
    catalog.find((s) => s.tenantId === tenantId && s.code === code && !s.archivedAt) ?? null
  );
}

export function listSkus(
  catalog: ReadonlyArray<Sku>,
  tenantId: TenantId,
  filter?: { readonly categoryId?: string; readonly includeArchived?: boolean; readonly isAsset?: boolean },
): ReadonlyArray<Sku> {
  return catalog.filter((s) => {
    if (s.tenantId !== tenantId) return false;
    if (!filter?.includeArchived && s.archivedAt) return false;
    if (filter?.categoryId !== undefined && s.categoryId !== filter.categoryId) return false;
    if (filter?.isAsset !== undefined && s.isAsset !== filter.isAsset) return false;
    return true;
  });
}

// ─────────────────────────────────────────────────────────────────────
// Bulk import — CSV row[] → { successes, errors }
// ─────────────────────────────────────────────────────────────────────

export interface BulkImportResult {
  readonly created: ReadonlyArray<Sku>;
  readonly errors: ReadonlyArray<{ readonly row: number; readonly code: string; readonly message: string }>;
  readonly catalog: ReadonlyArray<Sku>;
}

function normaliseUnit(input: string): SkuUnit | null {
  const trimmed = input.trim().toLowerCase();
  const aliases: Readonly<Record<string, SkuUnit>> = {
    each: 'each',
    ea: 'each',
    pcs: 'each',
    pieces: 'each',
    pc: 'each',
    kg: 'kg',
    kilogram: 'kg',
    kilograms: 'kg',
    g: 'g',
    grams: 'g',
    l: 'L',
    liter: 'L',
    litre: 'L',
    liters: 'L',
    litres: 'L',
    ml: 'mL',
    milliliter: 'mL',
    millilitre: 'mL',
    m: 'm',
    meter: 'm',
    metre: 'm',
    cm: 'cm',
    mm: 'mm',
    box: 'box',
    boxes: 'box',
    roll: 'roll',
    rolls: 'roll',
    pack: 'pack',
    packs: 'pack',
    pair: 'pair',
    pairs: 'pair',
    set: 'set',
    sets: 'set',
  };
  return aliases[trimmed] ?? null;
}

export function bulkImportSkus(
  existing: ReadonlyArray<Sku>,
  tenantId: TenantId,
  rows: ReadonlyArray<SkuImportRow>,
  idGen: () => SkuId,
  categoryLookup?: (label: string) => string | null,
): BulkImportResult {
  let catalog: ReadonlyArray<Sku> = existing;
  const created: Sku[] = [];
  const errors: Array<{ row: number; code: string; message: string }> = [];
  rows.forEach((raw, idx) => {
    const parsed = SkuImportRowSchema.safeParse(raw);
    if (!parsed.success) {
      errors.push({ row: idx, code: raw.code ?? '', message: parsed.error.message });
      return;
    }
    const unit = normaliseUnit(parsed.data.unit);
    if (!unit) {
      errors.push({ row: idx, code: parsed.data.code, message: `unknown unit "${parsed.data.unit}"` });
      return;
    }
    const draft: SkuDraft = {
      code: parsed.data.code,
      name: parsed.data.name,
      ...(parsed.data.description !== undefined && { description: parsed.data.description }),
      categoryId: parsed.data.category
        ? (categoryLookup?.(parsed.data.category) ?? null)
        : null,
      unit,
      defaultUnitCostCents: parsed.data.defaultUnitCostCents ?? 0,
      minimumStockLevel: parsed.data.minimumStockLevel ?? 0,
      reorderQty: parsed.data.reorderQty ?? 0,
      leadTimeDays: parsed.data.leadTimeDays ?? 0,
      isAsset: parsed.data.isAsset ?? false,
      ...(parsed.data.barcode !== undefined && { barcode: parsed.data.barcode }),
    };
    const r = createSku(catalog, tenantId, draft, idGen);
    if (!r.ok) {
      errors.push({ row: idx, code: draft.code, message: r.error.message });
      return;
    }
    created.push(r.value.sku);
    catalog = r.value.catalog;
  });
  return { created, errors, catalog };
}

// ─────────────────────────────────────────────────────────────────────
// Category tree
// ─────────────────────────────────────────────────────────────────────

export function createCategory(
  existing: ReadonlyArray<SkuCategory>,
  tenantId: TenantId,
  name: string,
  parentCategoryId: string | null,
  idGen: () => string,
  description?: string,
): Result<{ readonly category: SkuCategory; readonly tree: ReadonlyArray<SkuCategory> }, 'BAD_REQUEST'> {
  if (!name.trim()) return err('BAD_REQUEST', 'category name required');
  if (parentCategoryId) {
    const parent = existing.find((c) => c.id === parentCategoryId && c.tenantId === tenantId);
    if (!parent) return err('BAD_REQUEST', `parent category ${parentCategoryId} not found`);
  }
  const category: SkuCategory = {
    id: idGen(),
    tenantId,
    name: name.trim(),
    parentCategoryId,
    ...(description !== undefined && { description }),
  };
  return ok({ category, tree: [...existing, category] });
}

export interface CategoryNode {
  readonly category: SkuCategory;
  readonly children: ReadonlyArray<CategoryNode>;
}

export function buildCategoryTree(
  categories: ReadonlyArray<SkuCategory>,
  tenantId: TenantId,
): ReadonlyArray<CategoryNode> {
  const scoped = categories.filter((c) => c.tenantId === tenantId);
  const childMap = new Map<string | null, SkuCategory[]>();
  for (const c of scoped) {
    const key = c.parentCategoryId;
    const list = childMap.get(key) ?? [];
    list.push(c);
    childMap.set(key, list);
  }
  const build = (parent: string | null): ReadonlyArray<CategoryNode> => {
    const kids = childMap.get(parent) ?? [];
    return kids.map((c) => ({ category: c, children: build(c.id) }));
  };
  return build(null);
}
