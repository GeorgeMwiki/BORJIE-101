
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { authMiddleware } from '../middleware/hono-auth';
import { databaseMiddleware } from '../middleware/database';
import { majorToMinor, mapWorkOrderRow, paginateArray } from './db-mappers';
import { parseListPagination, buildListResponse } from './pagination';

import { withSecurityEvents } from '@borjie/observability';
const WorkOrderCreateSchema = z.object({
  propertyId: z.string().min(1),
  unitId: z.string().optional(),
  customerId: z.string().optional(),
  vendorId: z.string().optional(),
  priority: z.enum(['emergency', 'high', 'medium', 'low']).optional(),
  category: z.string().max(50).optional(),
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(5000),
  location: z.string().max(200).optional(),
  attachments: z.array(z.string().url()).optional(),
  estimatedCost: z.number().nonnegative().optional(),
  currency: z.string().length(3).optional(),
});
const WorkOrderUpdateSchema = z.object({
  vendorId: z.string().optional(),
  priority: z.string().optional(),
  status: z.string().optional(),
  category: z.string().optional(),
  title: z.string().max(200).optional(),
  description: z.string().max(5000).optional(),
  location: z.string().max(200).optional(),
  attachments: z.array(z.string().url()).optional(),
  estimatedCost: z.union([
    z.number().nonnegative(),
    z.object({ amount: z.number().nonnegative() }),
  ]).optional(),
  actualCost: z.union([
    z.number().nonnegative(),
    z.object({ amount: z.number().nonnegative() }),
  ]).optional(),
  scheduledAt: z.string().optional(),
  scheduledDate: z.string().optional(),
  completedAt: z.string().optional(),
  completionNotes: z.string().max(5000).optional(),
});

function workOrderNumber() {
  return `WO-${Date.now().toString().slice(-6)}`;
}

/**
 * P84 audit: `new Date(maybeUserString)` silently returns an Invalid
 * Date for malformed input, then writes `NaN` into the DB or throws a
 * cryptic "RangeError: Invalid time value" downstream. Validate
 * loudly so the caller receives a 400 instead.
 */
function parseUserDate(raw: string | undefined | null): Date | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`INVALID_DATE: '${raw}' is not a parseable ISO timestamp`);
  }
  return d;
}

const app = new Hono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

async function updateWorkOrder(c: any) {
  const auth = c.get('auth');
  const repos = c.get('repos');
  // Caller pre-validated via zValidator middleware; we re-use valid('json').
  const body = c.req.valid('json');
  const estimatedCost =
    body.estimatedCost && typeof body.estimatedCost === 'object'
      ? body.estimatedCost.amount
      : body.estimatedCost;
  const actualCost =
    body.actualCost && typeof body.actualCost === 'object'
      ? body.actualCost.amount
      : body.actualCost;

  let scheduledAt: Date | undefined;
  let completedAt: Date | undefined;
  try {
    scheduledAt = parseUserDate(body.scheduledAt ?? body.scheduledDate);
    completedAt = parseUserDate(body.completedAt);
  } catch (err) {
    return c.json(
      {
        success: false,
        error: {
          code: 'INVALID_DATE',
          message: err instanceof Error ? err.message : 'Invalid date',
        },
      },
      400,
    );
  }

  const row = await repos.workOrders.update(c.req.param('id'), auth.tenantId, {
    vendorId: body.vendorId,
    priority: body.priority ? String(body.priority).toLowerCase() : undefined,
    status: body.status ? String(body.status).toLowerCase() : undefined,
    category: body.category ? String(body.category).toLowerCase() : undefined,
    title: body.title,
    description: body.description,
    location: body.location,
    attachments: body.attachments,
    estimatedCost: estimatedCost != null ? majorToMinor(estimatedCost) : undefined,
    actualCost: actualCost != null ? majorToMinor(actualCost) : undefined,
    scheduledAt,
    completedAt,
    completionNotes: body.completionNotes,
    updatedBy: auth.userId,
  });
  if (!row) return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Work order not found' } }, 404);
  return c.json({ success: true, data: mapWorkOrderRow(row) });
}

app.get('/', async (c) => {
  const auth = c.get('auth');
  const repos = c.get('repos');
  const p = parseListPagination(c);
  const propertyId = c.req.query('propertyId');
  const customerId = c.req.query('customerId');
  const vendorId = c.req.query('vendorId');
  const status = c.req.query('status')?.toLowerCase();

  let result;
  if (propertyId) result = await repos.workOrders.findByProperty(propertyId, auth.tenantId, p.limit, p.offset);
  else if (customerId) result = await repos.workOrders.findByCustomer(customerId, auth.tenantId, p.limit, p.offset);
  else if (vendorId) result = await repos.workOrders.findByVendor(vendorId, auth.tenantId, p.limit, p.offset);
  else if (status) result = await repos.workOrders.findByStatus(status, auth.tenantId, p.limit, p.offset);
  else result = await repos.workOrders.findMany(auth.tenantId, p.limit, p.offset);

  const items = result.items.map(mapWorkOrderRow);
  return c.json({ success: true, ...buildListResponse(items, result.total ?? items.length, p) });
});

app.get('/my-tasks', async (c) => {
  const auth = c.get('auth');
  const repos = c.get('repos');
  const p = parseListPagination(c);
  const result = await repos.workOrders.findMany(auth.tenantId, p.limit, p.offset);
  return c.json({
    success: true,
    ...buildListResponse(result.items.map(mapWorkOrderRow), result.total ?? result.items.length, p),
  });
});

app.get('/my-requests', async (c) => {
  const auth = c.get('auth');
  const repos = c.get('repos');
  const result = await repos.workOrders.findByCustomer(auth.userId, auth.tenantId, 1000, 0);
  return c.json({ success: true, data: result.items.map(mapWorkOrderRow) });
});

app.get('/:id', async (c) => {
  const auth = c.get('auth');
  const repos = c.get('repos');
  const row = await repos.workOrders.findById(c.req.param('id'), auth.tenantId);
  if (!row) return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Work order not found' } }, 404);
  return c.json({ success: true, data: mapWorkOrderRow(row) });
});

app.post('/', zValidator('json', WorkOrderCreateSchema), withSecurityEvents({ action: 'work-order.create', resource: 'work-order', severity: 'info' }, async (c) => {
  const auth = c.get('auth');
  const repos = c.get('repos');
  const body = c.req.valid('json');
  const row = await repos.workOrders.create({
    id: crypto.randomUUID(),
    tenantId: auth.tenantId,
    propertyId: body.propertyId,
    unitId: body.unitId,
    customerId: body.customerId,
    vendorId: body.vendorId,
    workOrderNumber: workOrderNumber(),
    priority: String(body.priority || 'medium').toLowerCase(),
    status: 'submitted',
    category: String(body.category || 'other').toLowerCase(),
    source: body.customerId ? 'customer_request' : 'manager_created',
    title: body.title,
    description: body.description,
    location: body.location,
    attachments: body.attachments || [],
    estimatedCost: body.estimatedCost != null ? majorToMinor(body.estimatedCost) : undefined,
    currency: body.currency || 'USD',
    timeline: [{ at: new Date().toISOString(), status: 'submitted', by: auth.userId }],
    createdBy: auth.userId,
    updatedBy: auth.userId,
  });
  return c.json({ success: true, data: mapWorkOrderRow(row) }, 201);
}));

app.put('/:id', zValidator('json', WorkOrderUpdateSchema), withSecurityEvents({ action: 'work-order.update', resource: 'work-order', severity: 'info' }, async (c) => {
  return updateWorkOrder(c);
}));

app.patch('/:id', zValidator('json', WorkOrderUpdateSchema), withSecurityEvents({ action: 'work-order.update', resource: 'work-order', severity: 'info' }, async (c) => {
  return updateWorkOrder(c);
}));

app.delete('/:id', withSecurityEvents({ action: 'work-order.delete', resource: 'work-order', severity: 'notice' }, async (c) => {
  const auth = c.get('auth');
  const repos = c.get('repos');
  await repos.workOrders.delete(c.req.param('id'), auth.tenantId, auth.userId);
  return c.json({ success: true, data: { message: 'Work order deleted' } });
}));

export const workOrdersRouter = app;
