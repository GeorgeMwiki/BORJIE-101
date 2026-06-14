/**
 * Ore-stockpile warehouse router — Borjie mining domain.
 *
 * Mounted at `/api/v1/warehouse`. Tenant-isolated via auth middleware;
 * the underlying repos bind `app.current_tenant_id` (RLS FORCE), so the
 * router never double-filters by tenant.
 *
 *   GET    /stockpiles                         — list stockpiles (?locationKind=, ?parcelId=)
 *   POST   /stockpiles                         — register an ore stockpile
 *   GET    /stockpiles/:id                     — stockpile detail (+ latest grade)
 *   POST   /stockpiles/:id/transfers           — record a custody hand-over
 *   GET    /stockpiles/:id/transfers           — custody-event history (append-only)
 *   POST   /stockpiles/:id/grade               — append an ore-grade snapshot
 *
 * Legacy `/items*` paths are aliased onto the stockpile handlers so older
 * clients keep working through the property→mining cutover.
 *
 * Service is pulled from the composition root via `c.get('services').warehouse`.
 * When unwired (e.g. no DB), returns 503 with NOT_IMPLEMENTED so clients can
 * surface a clear reason without a hard crash.
 */
import { Hono, type Context } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { authMiddleware } from '../middleware/hono-auth';
import { databaseMiddleware } from '../middleware/database';
import {
  receiveStock,
  issueStock,
  adjustStock,
  type StockMovement,
} from '@borjie/inventory-management';
import { createDrizzleInventoryStore } from '../composition/inventory/drizzle-inventory-store';
import {
  planQuantityMovement,
  EmptyMovementError,
  type PlannedMovement,
} from './warehouse-quantity-movement';

import { withSecurityEvents } from '@borjie/observability';

/** Router dispatches at runtime — Hono's generic Context is sufficient. */
type AnyContext = Context;

interface WarehouseServiceError {
  readonly code: string;
  readonly message: string;
}

type WarehouseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: WarehouseServiceError };

/**
 * Structural contract the router needs from the mining warehouse service.
 * Kept local so the route stays decoupled from the concrete service type
 * in the composition root.
 */
interface MiningWarehouseService {
  listStockpiles(tenantId: string, filters: unknown): Promise<unknown>;
  createStockpile(
    tenantId: string,
    input: unknown,
    actor: string,
  ): Promise<WarehouseResult<unknown>>;
  getStockpile(
    tenantId: string,
    id: string,
  ): Promise<WarehouseResult<unknown | null>>;
  recordTransfer(
    tenantId: string,
    input: unknown,
    actor: string,
  ): Promise<WarehouseResult<unknown>>;
  listCustodyEvents(
    tenantId: string,
    stockpileId: string,
  ): Promise<WarehouseResult<unknown>>;
  recordGrade(
    tenantId: string,
    input: unknown,
    actor: string,
  ): Promise<WarehouseResult<unknown>>;
}

// ---------------------------------------------------------------------------
// Zod request schemas (mining domain)
// ---------------------------------------------------------------------------

const LocationKindSchema = z.enum(['site', 'warehouse', 'in_transit']);

const CreateStockpileSchema = z.object({
  parcelId: z.string().min(1).max(120),
  siteId: z.string().max(120).nullable().optional(),
  locationKind: LocationKindSchema.optional(),
  locationRef: z.string().max(200).nullable().optional(),
  quantityKg: z.number().nonnegative(),
  custodianUserId: z.string().max(120).nullable().optional(),
  attributes: z.record(z.string(), z.unknown()).optional(),
});

const TransferSchema = z.object({
  toUserId: z.string().min(1).max(120),
  toLocationKind: LocationKindSchema,
  toLocationRef: z.string().max(200).nullable().optional(),
  fingerprintEventId: z.string().max(200).nullable().optional(),
  occurredAt: z.string().datetime().optional(),
});

/**
 * Quantity-movement contract for the legacy `/items/:id/movements` POST.
 *
 * The worker store-issue screen (workforce-mobile W-M-10 / W-M-15 —
 * "Inventory Issue / Return") records a consumable/spares movement on a
 * stock SKU: a signed quantity in/out, not an ore-stockpile custody
 * hand-over. That is the consumables-inventory domain, so this path is
 * served by the REAL `@borjie/inventory-management` engine over
 * `inventory_skus` + `inventory_stock_movements` (migration 0292) —
 * NOT the immutable-tonnage ore-stockpile service (which mints/burns no
 * mass and therefore has no quantity-mutation method).
 *
 *   issue  → stock leaves the default store (negative on-hand delta)
 *   return → stock comes back into the default store (positive)
 *   adjust → signed correction (cycle-count true-up)
 *
 * `:id` is the SKU id. On-hand is replayed from the append-only log, so
 * an over-issue surfaces the package's `INSUFFICIENT_STOCK` (→ 409),
 * never a fabricated success.
 */
const QuantityMovementSchema = z.object({
  movementType: z.enum(['issue', 'return', 'adjust']),
  quantityDelta: z.number().int(),
  reason: z.string().max(2000).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Default store-location key for worker quantity movements. The worker
 * store screen issues/returns against the org's single default store; a
 * per-site location picker is a future enhancement. Stable so the
 * on-hand replay nets issues against returns at the same location.
 */
const DEFAULT_STORE_LOCATION_ID = 'default-store';

const GradeSchema = z.object({
  parcelId: z.string().min(1).max(120),
  gradePct: z.number().min(0).max(100),
  processability: z.number().min(0).max(1),
  blendability: z.number().min(0).max(1),
  targetCustomerFit: z
    .enum(['trader', 'smelter', 'refinery', 'export_buyer', 'broker'])
    .nullable()
    .optional(),
  assayEvidenceIds: z.array(z.string()).optional(),
  dimensions: z.record(z.string(), z.unknown()).optional(),
  snapshotByModel: z.string().max(120).nullable().optional(),
});

const app = new Hono();
app.use('*', authMiddleware);

function svc(c: AnyContext): MiningWarehouseService | undefined {
  const services =
    (c.get('services') as { warehouse?: MiningWarehouseService } | undefined) ??
    {};
  return services.warehouse;
}

function notImplemented(c: AnyContext) {
  return c.json(
    {
      success: false,
      error: {
        code: 'NOT_IMPLEMENTED',
        message: 'Warehouse service not wired into api-gateway context',
      },
    },
    503,
  );
}

function mapErr(c: AnyContext, result: WarehouseResult<unknown>, fallback = 400) {
  if (result.ok === true) {
    // Defensive: caller should gate on `!result.ok` before mapErr. If not,
    // fall through with a generic 500 rather than leaking an ok payload.
    return c.json(
      {
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'unexpected ok result' },
      },
      500 as import('hono/utils/http-status').ContentfulStatusCode,
    );
  }
  const err = (result as { ok: false; error: WarehouseServiceError }).error;
  const status: import('hono/utils/http-status').ContentfulStatusCode =
    err.code === 'NOT_FOUND'
      ? 404
      : err.code === 'TENANT_MISMATCH'
        ? 403
        : err.code === 'INTERNAL_ERROR'
          ? 500
          : (fallback as import('hono/utils/http-status').ContentfulStatusCode);
  return c.json(
    { success: false, error: { code: err.code, message: err.message } },
    status,
  );
}

// ---------------------------------------------------------------------------
// Handlers — extracted so legacy `/items*` aliases reuse them verbatim.
// ---------------------------------------------------------------------------

async function listHandler(c: AnyContext) {
  const auth = c.get('auth');
  const s = svc(c);
  if (!s) return notImplemented(c);
  const rawKind = c.req.query('locationKind');
  const parsedKind = rawKind ? LocationKindSchema.safeParse(rawKind) : undefined;
  const locationKind = parsedKind?.success ? parsedKind.data : undefined;
  const parcelId = c.req.query('parcelId') || undefined;
  const rows = await s.listStockpiles(auth.tenantId, { locationKind, parcelId });
  return c.json({ success: true, data: rows });
}

async function getHandler(c: AnyContext) {
  const auth = c.get('auth');
  const s = svc(c);
  if (!s) return notImplemented(c);
  const id = c.req.param('id');
  if (!id) {
    return c.json(
      { success: false, error: { code: 'INVALID_PARAM', message: 'id required' } },
      400,
    );
  }
  const result = await s.getStockpile(auth.tenantId, id);
  if (!result.ok) return mapErr(c, result);
  if (!result.value) {
    return c.json(
      { success: false, error: { code: 'NOT_FOUND', message: 'stockpile not found' } },
      404,
    );
  }
  return c.json({ success: true, data: result.value });
}

async function historyHandler(c: AnyContext) {
  const auth = c.get('auth');
  const s = svc(c);
  if (!s) return notImplemented(c);
  const id = c.req.param('id');
  if (!id) {
    return c.json(
      { success: false, error: { code: 'INVALID_PARAM', message: 'id required' } },
      400,
    );
  }
  const result = await s.listCustodyEvents(auth.tenantId, id);
  if (!result.ok) return mapErr(c, result);
  return c.json({ success: true, data: result.value });
}

/**
 * POST /items/:id/movements — worker store issue / return / adjust on a SKU.
 *
 * Served by the REAL `@borjie/inventory-management` engine (NOT the ore
 * stockpile service). Fail-closed: 503 when the DB is unwired, the package's
 * domain errors (e.g. INSUFFICIENT_STOCK → 409) propagate, and a movement is
 * only ever appended — never a fabricated success.
 */
async function quantityMovementHandler(c: AnyContext) {
  const auth = c.get('auth') as { tenantId?: string; userId?: string };
  const db = c.get('db');
  if (!db || !auth?.tenantId) return notImplemented(c);
  const skuId = c.req.param('id');
  if (!skuId) {
    return c.json(
      { success: false, error: { code: 'INVALID_PARAM', message: 'id required' } },
      400,
    );
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- zValidator output not threaded onto AnyContext.
  const body = (c as any).req.valid('json') as {
    movementType: 'issue' | 'return' | 'adjust';
    quantityDelta: number;
    reason?: string;
  };

  let planned: PlannedMovement;
  try {
    planned = planQuantityMovement(body, {
      skuId,
      locationId: DEFAULT_STORE_LOCATION_ID,
      ...(auth.userId ? { actorUserId: auth.userId } : {}),
    });
  } catch (e) {
    if (e instanceof EmptyMovementError) {
      return c.json(
        { success: false, error: { code: 'VALIDATION', message: e.message } },
        400,
      );
    }
    throw e;
  }

  try {
    const store = createDrizzleInventoryStore(db);
    const log = await store.loadMovements(auth.tenantId);
    const now = new Date().toISOString();
    const newId = () => randomUUID();

    let result:
      | { ok: true; value: { movement: StockMovement } }
      | { ok: false; error: { code: string; message: string } };

    if (planned.verb === 'receipt') {
      result = receiveStock(log, auth.tenantId, planned.args, newId, now);
    } else if (planned.verb === 'issue') {
      result = issueStock(log, auth.tenantId, planned.args, newId, now);
    } else {
      result = adjustStock(log, auth.tenantId, planned.args, newId, now);
    }

    if (!result.ok) {
      const status = result.error.code === 'INSUFFICIENT_STOCK' ? 409 : 400;
      return c.json(
        { success: false, error: { code: result.error.code, message: result.error.message } },
        status,
      );
    }
    await store.persistMovement(result.value.movement);
    return c.json({ success: true, data: result.value.movement }, 201);
  } catch (e) {
    return c.json(
      {
        success: false,
        error: {
          code: 'INVENTORY_MOVEMENT_FAILED',
          message: e instanceof Error ? e.message : 'movement failed',
        },
      },
      500,
    );
  }
}

// ---------------------------------------------------------------------------
// Routes — canonical mining paths
// ---------------------------------------------------------------------------

app.get('/stockpiles', listHandler);
app.get('/items', listHandler); // legacy alias

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- zValidator output type does not propagate through withSecurityEvents wrapper.
app.post('/stockpiles', zValidator('json', CreateStockpileSchema), withSecurityEvents({ action: 'warehouse.create', resource: 'warehouse', severity: 'info' }, async (c: any) => {
  const auth = c.get('auth');
  const body = c.req.valid('json');
  const s = svc(c);
  if (!s) return notImplemented(c);
  const result = await s.createStockpile(auth.tenantId, body, auth.userId);
  if (!result.ok) return mapErr(c, result);
  return c.json({ success: true, data: result.value }, 201);
}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- zValidator output type does not propagate through withSecurityEvents wrapper.
app.post('/items', zValidator('json', CreateStockpileSchema), withSecurityEvents({ action: 'warehouse.create', resource: 'warehouse', severity: 'info' }, async (c: any) => {
  const auth = c.get('auth');
  const body = c.req.valid('json');
  const s = svc(c);
  if (!s) return notImplemented(c);
  const result = await s.createStockpile(auth.tenantId, body, auth.userId);
  if (!result.ok) return mapErr(c, result);
  return c.json({ success: true, data: result.value }, 201);
}));

app.get('/stockpiles/:id', getHandler);
app.get('/items/:id', getHandler); // legacy alias

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- zValidator output type does not propagate through withSecurityEvents wrapper.
app.post('/stockpiles/:id/transfers', zValidator('json', TransferSchema), withSecurityEvents({ action: 'warehouse.create', resource: 'warehouse', severity: 'info' }, async (c: any) => {
  const auth = c.get('auth');
  const body = c.req.valid('json');
  const s = svc(c);
  if (!s) return notImplemented(c);
  const result = await s.recordTransfer(
    auth.tenantId,
    { ...body, stockpileId: c.req.param('id') },
    auth.userId,
  );
  if (!result.ok) return mapErr(c, result);
  return c.json({ success: true, data: result.value }, 201);
}));
// Legacy worker store-issue/return contract — served by the REAL consumables
// inventory engine (see QuantityMovementSchema docstring). Needs the
// RLS-pinned `db`, so `databaseMiddleware` is attached on just this route.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- zValidator output type does not propagate through withSecurityEvents wrapper.
app.post('/items/:id/movements', databaseMiddleware, zValidator('json', QuantityMovementSchema), withSecurityEvents({ action: 'warehouse.create', resource: 'warehouse', severity: 'info' }, async (c: any) => {
  return quantityMovementHandler(c);
}));

app.get('/stockpiles/:id/transfers', historyHandler);
app.get('/items/:id/movements', historyHandler); // legacy alias

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- zValidator output type does not propagate through withSecurityEvents wrapper.
app.post('/stockpiles/:id/grade', zValidator('json', GradeSchema), withSecurityEvents({ action: 'warehouse.create', resource: 'warehouse', severity: 'info' }, async (c: any) => {
  const auth = c.get('auth');
  const body = c.req.valid('json');
  const s = svc(c);
  if (!s) return notImplemented(c);
  const result = await s.recordGrade(auth.tenantId, body, auth.userId);
  if (!result.ok) return mapErr(c, result);
  return c.json({ success: true, data: result.value }, 201);
}));

export const warehouseRouter = app;
export default app;
