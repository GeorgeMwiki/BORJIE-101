/**
 * Warehouse inventory router — Wave 8 (S7 gap closure)
 *
 * Mounted at `/api/v1/warehouse`. Tenant-isolated via auth middleware.
 *
 *   GET    /items                         — list items (?category=, ?condition=)
 *   POST   /items                         — create item + opening-stock receipt
 *   GET    /items/:id                     — item detail
 *   POST   /items/:id/movements           — append a stock movement
 *   GET    /items/:id/movements           — movement history
 *
 * Service is pulled from the composition root via `c.get('services').warehouse`.
 * When unwired (e.g. no DB), returns 503 with NOT_IMPLEMENTED so clients can
 * surface a clear reason without a hard crash.
 */
import { Hono, type Context } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { authMiddleware } from '../middleware/hono-auth';

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

interface WarehouseService {
  listItems(tenantId: string, filters: unknown): Promise<unknown>;
  createItem(tenantId: string, input: unknown, actor: string): Promise<WarehouseResult<unknown>>;
  getItem(tenantId: string, id: string): Promise<WarehouseResult<unknown | null>>;
  recordMovement(
    tenantId: string,
    input: unknown,
    actor: string
  ): Promise<WarehouseResult<unknown>>;
  listMovements(tenantId: string, itemId: string): Promise<WarehouseResult<unknown>>;
}
const ConditionSchema = z.enum([
  'new',
  'functioning',
  'broken',
  'in_transit',
  'decommissioned',
  'reserved',
]);

const MovementTypeSchema = z.enum([
  'receive',
  'issue',
  'transfer',
  'adjust',
  'install',
  'uninstall',
  'decommission',
  'return',
  'damage',
  'repair',
]);

const CreateItemSchema = z.object({
  sku: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  category: z.string().min(1).max(80),
  description: z.string().max(2000).optional(),
  unitOfMeasure: z.string().max(40).optional(),
  quantity: z.number().int().nonnegative().optional(),
  condition: ConditionSchema.optional(),
  warehouseLocation: z.string().max(200).optional(),
  costMinorUnits: z.number().int().nonnegative().optional(),
  currency: z.string().length(3).optional(),
  supplierName: z.string().max(200).optional(),
  purchaseOrderRef: z.string().max(100).optional(),
  notes: z.string().max(2000).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const MovementSchema = z.object({
  movementType: MovementTypeSchema,
  quantityDelta: z.number().int(),
  conditionTo: ConditionSchema.optional(),
  destination: z.string().max(200).optional(),
  relatedCaseId: z.string().max(100).optional(),
  relatedUnitId: z.string().max(100).optional(),
  reason: z.string().max(500).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const app = new Hono();
app.use('*', authMiddleware);

function svc(c: AnyContext): WarehouseService | undefined {
  const services =
    (c.get('services') as { warehouse?: WarehouseService } | undefined) ?? {};
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
    503
  );
}

function mapErr(
  c: AnyContext,
  result: { error: WarehouseServiceError },
  fallback = 400,
) {
  const status =
    result.error.code === 'NOT_FOUND'
      ? 404
      : result.error.code === 'TENANT_MISMATCH'
        ? 403
        : result.error.code === 'DUPLICATE_SKU'
          ? 409
          : result.error.code === 'INSUFFICIENT_STOCK'
            ? 409
            : result.error.code === 'INTERNAL_ERROR'
              ? 500
              : fallback;
  return c.json(
    { success: false, error: { code: result.error.code, message: result.error.message } },
    status
  );
}

app.get('/items', async (c: AnyContext) => {
  const auth = c.get('auth');
  const s = svc(c);
  if (!s) return notImplemented(c);
  const category = c.req.query('category') || undefined;
  const rawCondition = c.req.query('condition');
  const conditionParsed = rawCondition
    ? ConditionSchema.safeParse(rawCondition)
    : undefined;
  const condition = conditionParsed?.success ? conditionParsed.data : undefined;
  const items = await s.listItems(auth.tenantId, { category, condition });
  return c.json({ success: true, data: items });
});

app.post('/items', zValidator('json', CreateItemSchema), withSecurityEvents({ action: 'warehouse.create', resource: 'warehouse', severity: 'info' }, async (c: AnyContext) => {
  const auth = c.get('auth');
  const body = c.req.valid('json');
  const s = svc(c);
  if (!s) return notImplemented(c);
  const result = await s.createItem(auth.tenantId, body, auth.userId);
  if (!result.ok) return mapErr(c, result);
  return c.json({ success: true, data: result.value }, 201);
}));

app.get('/items/:id', async (c: AnyContext) => {
  const auth = c.get('auth');
  const s = svc(c);
  if (!s) return notImplemented(c);
  const result = await s.getItem(auth.tenantId, c.req.param('id'));
  if (!result.ok) return mapErr(c, result);
  if (!result.value) {
    return c.json(
      { success: false, error: { code: 'NOT_FOUND', message: 'item not found' } },
      404
    );
  }
  return c.json({ success: true, data: result.value });
});

app.post('/items/:id/movements', zValidator('json', MovementSchema), withSecurityEvents({ action: 'warehouse.create', resource: 'warehouse', severity: 'info' }, async (c: AnyContext) => {
  const auth = c.get('auth');
  const body = c.req.valid('json');
  const s = svc(c);
  if (!s) return notImplemented(c);
  const result = await s.recordMovement(
    auth.tenantId,
    { ...body, warehouseItemId: c.req.param('id') },
    auth.userId
  );
  if (!result.ok) return mapErr(c, result);
  return c.json({ success: true, data: result.value }, 201);
}));

app.get('/items/:id/movements', async (c: AnyContext) => {
  const auth = c.get('auth');
  const s = svc(c);
  if (!s) return notImplemented(c);
  const result = await s.listMovements(auth.tenantId, c.req.param('id'));
  if (!result.ok) return mapErr(c, result);
  return c.json({ success: true, data: result.value });
});

export const warehouseRouter = app;
export default app;
