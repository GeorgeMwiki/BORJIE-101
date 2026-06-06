/**
 * /api/v1/mining/inventory — REAL consumables / spares inventory, backed by
 * `@borjie/inventory-management` (createInventoryManagement + pure-function
 * compute) over the durable tables `inventory_skus` +
 * `inventory_stock_movements` (migration 0292).
 *
 * Routes:
 *   GET  /skus                      list the SKU catalog
 *   GET  /reorder                   reorder candidates + suggested PO drafts
 *                                   (package `reorderWithPurchaseOrder` — ABC
 *                                   band + shortfall + lead-time, all real)
 *   GET  /analytics/on-hand-value   stock-on-hand value by category (replays
 *                                   the movement log × unit cost)
 *   GET  /analytics/dead-stock      SKU+location pairs idle ≥ N days w/ on-hand
 *   POST /skus                      create a SKU (package `createSku` → persist)
 *   POST /movements                 append a stock movement (receipt / issue /
 *                                   adjustment → package verb → persist)
 *
 * Every figure is DERIVED by the package's pure functions from the persisted
 * append-only movement log — never a fabricated balance. On-hand is replayed,
 * not stored.
 *
 * MONEY NEUTRALITY (CLAUDE.md): the only money field is minor-units
 * (`defaultUnitCostCents`); no currency literal in any code path.
 *
 * RLS: `databaseMiddleware` binds `app.current_tenant_id`; both tables are
 * FORCE-RLS. The Drizzle store also filters every read by tenantId
 * (defence in depth). All inputs validated with zod.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';

import {
  createInventoryManagement,
  createSku,
  receiveStock,
  issueStock,
  adjustStock,
  listSkus,
  stockOnHandValue,
  deadStockReport,
  type StockMovement,
} from '@borjie/inventory-management';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { createLogger } from '../../utils/logger';
import { createDrizzleInventoryStore } from '../../composition/inventory/drizzle-inventory-store';

const moduleLogger = createLogger('mining-inventory');

function unavailable(c: { json: (b: unknown, s: number) => Response }): Response {
  return c.json(
    { success: false as const, error: { code: 'INVENTORY_DB_UNAVAILABLE' } },
    503,
  );
}

// ── Input schemas ───────────────────────────────────────────────────────────

const CreateSkuSchema = z.object({
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  categoryId: z.string().nullable().default(null),
  unit: z.string().min(1).max(16).default('each'),
  defaultUnitCostCents: z.number().int().nonnegative().default(0),
  minimumStockLevel: z.number().int().nonnegative().default(0),
  reorderQty: z.number().int().nonnegative().default(0),
  leadTimeDays: z.number().int().nonnegative().default(0),
  isAsset: z.boolean().default(false),
  barcode: z.string().max(120).optional(),
  qrCode: z.string().max(500).optional(),
  supplierVendorIds: z.array(z.string()).optional(),
});

const MovementSchema = z.object({
  type: z.enum(['receipt', 'issue', 'adjustment']),
  skuId: z.string().min(1),
  /** Receipt / adjustment use `locationId`; issue uses `fromLocationId`. */
  locationId: z.string().min(1).optional(),
  fromLocationId: z.string().min(1).optional(),
  quantity: z.number().int().optional(),
  /** Signed delta for adjustments. */
  delta: z.number().int().optional(),
  reference: z.string().max(200).optional(),
  notes: z.string().max(2000).optional(),
});

export const miningInventoryRouter = new Hono();
miningInventoryRouter.use('*', authMiddleware);
miningInventoryRouter.use('*', databaseMiddleware);

// ---------------------------------------------------------------------------
// GET /skus — the catalog.
// ---------------------------------------------------------------------------
miningInventoryRouter.get('/skus', async (c) => {
  const auth = c.get('auth') as { tenantId?: string };
  const db = c.get('db');
  if (!db || !auth?.tenantId) return unavailable(c);
  try {
    const store = createDrizzleInventoryStore(db);
    const skus = await store.loadSkus(auth.tenantId);
    return c.json(
      { success: true as const, data: { skus: listSkus(skus, auth.tenantId), count: skus.length } },
      200,
    );
  } catch (err) {
    moduleLogger.error({ err, tenantId: auth.tenantId }, 'inventory_skus_failed');
    return c.json(
      { success: false as const, error: { code: 'INVENTORY_SKUS_FAILED' } },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /reorder — reorder candidates + suggested PO drafts (REAL compute).
// ---------------------------------------------------------------------------
miningInventoryRouter.get('/reorder', async (c) => {
  const auth = c.get('auth') as { tenantId?: string };
  const db = c.get('db');
  if (!db || !auth?.tenantId) return unavailable(c);
  const locationId = c.req.query('locationId') || undefined;
  try {
    const store = createDrizzleInventoryStore(db);
    const inventory = createInventoryManagement({ store });
    const result = await inventory.reorderWithPurchaseOrder(auth.tenantId, {
      ...(locationId ? { locationId } : {}),
      createDraft: false,
    });
    return c.json(
      {
        success: true as const,
        data: {
          candidates: result.candidates,
          purchaseOrderSpecs: result.specs,
          count: result.candidates.length,
        },
      },
      200,
    );
  } catch (err) {
    moduleLogger.error({ err, tenantId: auth.tenantId }, 'inventory_reorder_failed');
    return c.json(
      { success: false as const, error: { code: 'INVENTORY_REORDER_FAILED' } },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /analytics/on-hand-value — Σ qty × unit cost, by category.
// ---------------------------------------------------------------------------
miningInventoryRouter.get('/analytics/on-hand-value', async (c) => {
  const auth = c.get('auth') as { tenantId?: string };
  const db = c.get('db');
  if (!db || !auth?.tenantId) return unavailable(c);
  const locationId = c.req.query('locationId') || null;
  try {
    const store = createDrizzleInventoryStore(db);
    const [skus, log, categories] = await Promise.all([
      store.loadSkus(auth.tenantId),
      store.loadMovements(auth.tenantId),
      store.loadCategories(auth.tenantId),
    ]);
    const snapshot = stockOnHandValue(
      skus,
      categories,
      log,
      auth.tenantId,
      locationId,
      new Date().toISOString(),
    );
    return c.json({ success: true as const, data: snapshot }, 200);
  } catch (err) {
    moduleLogger.error(
      { err, tenantId: auth.tenantId },
      'inventory_on_hand_value_failed',
    );
    return c.json(
      { success: false as const, error: { code: 'INVENTORY_ON_HAND_VALUE_FAILED' } },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /analytics/dead-stock — idle SKU+location pairs with positive on-hand.
// ---------------------------------------------------------------------------
miningInventoryRouter.get('/analytics/dead-stock', async (c) => {
  const auth = c.get('auth') as { tenantId?: string };
  const db = c.get('db');
  if (!db || !auth?.tenantId) return unavailable(c);
  const staleParsed = z.coerce
    .number()
    .int()
    .positive()
    .max(3650)
    .safeParse(c.req.query('staleDays'));
  const staleDays = staleParsed.success ? staleParsed.data : 180;
  try {
    const store = createDrizzleInventoryStore(db);
    const log = await store.loadMovements(auth.tenantId);
    const items = deadStockReport(
      log,
      auth.tenantId,
      new Date().toISOString(),
      staleDays,
    );
    return c.json(
      { success: true as const, data: { items, staleDays, count: items.length } },
      200,
    );
  } catch (err) {
    moduleLogger.error(
      { err, tenantId: auth.tenantId },
      'inventory_dead_stock_failed',
    );
    return c.json(
      { success: false as const, error: { code: 'INVENTORY_DEAD_STOCK_FAILED' } },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// POST /skus — create a catalog SKU (package validation + dup-code guard).
// ---------------------------------------------------------------------------
miningInventoryRouter.post('/skus', async (c) => {
  const auth = c.get('auth') as { tenantId?: string };
  const db = c.get('db');
  if (!db || !auth?.tenantId) return unavailable(c);
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      { success: false as const, error: { code: 'VALIDATION_ERROR', message: 'Invalid JSON body' } },
      400,
    );
  }
  const parsed = CreateSkuSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { success: false as const, error: { code: 'VALIDATION_ERROR', message: parsed.error.message } },
      400,
    );
  }
  try {
    const store = createDrizzleInventoryStore(db);
    const existing = await store.loadSkus(auth.tenantId);
    const created = createSku(
      existing,
      auth.tenantId,
      {
        code: parsed.data.code,
        name: parsed.data.name,
        ...(parsed.data.description !== undefined ? { description: parsed.data.description } : {}),
        categoryId: parsed.data.categoryId,
        unit: parsed.data.unit as never,
        defaultUnitCostCents: parsed.data.defaultUnitCostCents,
        minimumStockLevel: parsed.data.minimumStockLevel,
        reorderQty: parsed.data.reorderQty,
        leadTimeDays: parsed.data.leadTimeDays,
        isAsset: parsed.data.isAsset,
        ...(parsed.data.barcode !== undefined ? { barcode: parsed.data.barcode } : {}),
        ...(parsed.data.qrCode !== undefined ? { qrCode: parsed.data.qrCode } : {}),
        ...(parsed.data.supplierVendorIds !== undefined ? { supplierVendorIds: parsed.data.supplierVendorIds } : {}),
      },
      () => randomUUID(),
    );
    if (!created.ok) {
      const status = created.error.code === 'DUPLICATE_CODE' ? 409 : 400;
      return c.json(
        { success: false as const, error: { code: created.error.code, message: created.error.message } },
        status,
      );
    }
    await store.persistSku(created.value.sku);
    return c.json({ success: true as const, data: created.value.sku }, 201);
  } catch (err) {
    moduleLogger.error({ err, tenantId: auth.tenantId }, 'inventory_create_sku_failed');
    return c.json(
      { success: false as const, error: { code: 'INVENTORY_CREATE_SKU_FAILED' } },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// POST /movements — append a stock movement (receipt / issue / adjustment).
// ---------------------------------------------------------------------------
miningInventoryRouter.post('/movements', async (c) => {
  const auth = c.get('auth') as { tenantId?: string; userId?: string };
  const db = c.get('db');
  if (!db || !auth?.tenantId) return unavailable(c);
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      { success: false as const, error: { code: 'VALIDATION_ERROR', message: 'Invalid JSON body' } },
      400,
    );
  }
  const parsed = MovementSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { success: false as const, error: { code: 'VALIDATION_ERROR', message: parsed.error.message } },
      400,
    );
  }
  const input = parsed.data;
  try {
    const store = createDrizzleInventoryStore(db);
    const log = await store.loadMovements(auth.tenantId);
    const now = new Date().toISOString();
    const actorUserId = auth.userId;

    let result:
      | { ok: true; value: { movement: StockMovement } }
      | { ok: false; error: { code: string; message: string } };

    if (input.type === 'receipt') {
      if (!input.locationId || input.quantity === undefined || input.quantity <= 0) {
        return c.json(
          { success: false as const, error: { code: 'VALIDATION_ERROR', message: 'receipt requires locationId + positive quantity' } },
          400,
        );
      }
      result = receiveStock(
        log,
        auth.tenantId,
        {
          skuId: input.skuId,
          locationId: input.locationId,
          quantity: input.quantity,
          ...(input.reference ? { reference: input.reference } : {}),
          ...(actorUserId ? { actorUserId } : {}),
          ...(input.notes ? { notes: input.notes } : {}),
        },
        () => randomUUID(),
        now,
      );
    } else if (input.type === 'issue') {
      if (!input.fromLocationId || input.quantity === undefined || input.quantity <= 0) {
        return c.json(
          { success: false as const, error: { code: 'VALIDATION_ERROR', message: 'issue requires fromLocationId + positive quantity' } },
          400,
        );
      }
      result = issueStock(
        log,
        auth.tenantId,
        {
          skuId: input.skuId,
          fromLocationId: input.fromLocationId,
          quantity: input.quantity,
          ...(input.reference ? { reference: input.reference } : {}),
          ...(actorUserId ? { actorUserId } : {}),
          ...(input.notes ? { notes: input.notes } : {}),
        },
        () => randomUUID(),
        now,
      );
    } else {
      // adjustment
      if (!input.locationId || input.delta === undefined || input.delta === 0) {
        return c.json(
          { success: false as const, error: { code: 'VALIDATION_ERROR', message: 'adjustment requires locationId + non-zero delta' } },
          400,
        );
      }
      result = adjustStock(
        log,
        auth.tenantId,
        {
          skuId: input.skuId,
          locationId: input.locationId,
          delta: input.delta,
          ...(input.reference ? { reason: input.reference } : {}),
          ...(actorUserId ? { actorUserId } : {}),
        },
        () => randomUUID(),
        now,
      );
    }

    if (!result.ok) {
      const status = result.error.code === 'INSUFFICIENT_STOCK' ? 409 : 400;
      return c.json(
        { success: false as const, error: { code: result.error.code, message: result.error.message } },
        status,
      );
    }
    await store.persistMovement(result.value.movement);
    return c.json({ success: true as const, data: result.value.movement }, 201);
  } catch (err) {
    moduleLogger.error({ err, tenantId: auth.tenantId }, 'inventory_movement_failed');
    return c.json(
      { success: false as const, error: { code: 'INVENTORY_MOVEMENT_FAILED' } },
      500,
    );
  }
});

export default miningInventoryRouter;
