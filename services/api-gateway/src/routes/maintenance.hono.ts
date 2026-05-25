
/**
 * /api/v1/maintenance — maintenance requests, dispatch events, and
 * completion proofs.
 *
 * Routes:
 *   GET    /requests                  list maintenance requests
 *   GET    /requests/:id              fetch one
 *   POST   /requests                  create
 *   PATCH  /requests/:id              update status / fields
 *   POST   /requests/:id/dispatch     create a dispatch event + set status
 *   POST   /requests/:id/complete     submit completion proof
 *   GET    /requests/:id/dispatch-events  list dispatch events on a request
 *   POST   /completion-proofs/:id/verify   mark a completion proof verified
 *   POST   /completion-proofs/:id/reject   mark a completion proof rejected
 *
 * All routes are auth + tenant scoped (authMiddleware + databaseMiddleware).
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { v4 as uuid } from 'uuid';
import { authMiddleware } from '../middleware/hono-auth';
import { databaseMiddleware } from '../middleware/database';
import {
  DispatchEventRepository,
  CompletionProofRepository,
} from '@borjie/database';
import { and, eq, desc } from 'drizzle-orm';
import { maintenanceRequests } from '@borjie/database';

import { withSecurityEvents } from '@borjie/observability';
const app = new Hono();

app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function auth(c) {
  return c.get('auth') as { userId: string; tenantId: string; role: string };
}
function db(c) {
  return c.get('db');
}

// ---------------------------------------------------------------------------
// Maintenance requests
// ---------------------------------------------------------------------------

const CreateRequestSchema = z.object({
  propertyId: z.string().min(1),
  unitId: z.string().optional(),
  customerId: z.string().optional(),
  title: z.string().min(1).max(200),
  description: z.string().max(5_000).optional(),
  category: z.string().optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent', 'emergency']).default('medium'),
  source: z.string().optional(),
  photos: z.array(z.object({ url: z.string(), caption: z.string().optional() })).optional(),
  location: z.string().optional(),
  preferredWindow: z
    .object({ start: z.string(), end: z.string() })
    .optional(),
});

const UpdateRequestSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  category: z.string().optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent', 'emergency']).optional(),
  status: z
    .enum([
      'submitted',
      'triaged',
      'classified',
      'dispatched',
      'in_progress',
      'awaiting_parts',
      'completed',
      'verified',
      'rejected',
      'cancelled',
    ])
    .optional(),
});

app.get('/requests', async (c) => {
  const { tenantId } = auth(c);
  const status = c.req.query('status');
  const limit = Math.min(Number(c.req.query('limit') ?? 100), 500);
  const conds = [eq(maintenanceRequests.tenantId, tenantId)];
  if (status) conds.push(eq(maintenanceRequests.status, status));
  const rows = await db(c)
    .select()
    .from(maintenanceRequests)
    .where(and(...conds))
    .orderBy(desc(maintenanceRequests.createdAt))
    .limit(limit);
  return c.json({ success: true, data: rows });
});

app.get('/requests/:id', async (c) => {
  const { tenantId } = auth(c);
  const id = c.req.param('id');
  const [row] = await db(c)
    .select()
    .from(maintenanceRequests)
    .where(
      and(eq(maintenanceRequests.id, id), eq(maintenanceRequests.tenantId, tenantId))
    )
    .limit(1);
  if (!row) return c.json({ error: 'not_found' }, 404);
  return c.json({ success: true, data: row });
});

app.post('/requests', zValidator('json', CreateRequestSchema), withSecurityEvents({ action: 'maintenance.create', resource: 'maintenance', severity: 'info' }, async (c) => {
  const { userId, tenantId } = auth(c);
  const input = c.req.valid('json');
  const id = uuid();
  const now = new Date();
  const requestNumber = `MR-${Date.now().toString(36).toUpperCase()}-${id.slice(0, 4).toUpperCase()}`;
  const [row] = await db(c)
    .insert(maintenanceRequests)
    .values({
      id,
      tenantId,
      propertyId: input.propertyId,
      unitId: input.unitId ?? null,
      customerId: input.customerId ?? null,
      workOrderId: null,
      requestNumber,
      title: input.title,
      description: input.description ?? null,
      category: input.category ?? null,
      priority: input.priority,
      status: 'submitted',
      source: input.source ?? 'customer_request',
      photos: input.photos ?? [],
      location: input.location ?? null,
      preferredWindow: input.preferredWindow ?? null,
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
      updatedBy: userId,
    })
    .returning();
  return c.json({ success: true, data: row }, 201);
}));

app.patch('/requests/:id', zValidator('json', UpdateRequestSchema), withSecurityEvents({ action: 'maintenance.update', resource: 'maintenance', severity: 'info' }, async (c) => {
  const { userId, tenantId } = auth(c);
  const id = c.req.param('id');
  const input = c.req.valid('json');
  const [row] = await db(c)
    .update(maintenanceRequests)
    .set({ ...input, updatedAt: new Date(), updatedBy: userId })
    .where(
      and(eq(maintenanceRequests.id, id), eq(maintenanceRequests.tenantId, tenantId))
    )
    .returning();
  if (!row) return c.json({ error: 'not_found' }, 404);
  return c.json({ success: true, data: row });
}));

// ---------------------------------------------------------------------------
// Dispatch events
// ---------------------------------------------------------------------------

const DispatchSchema = z.object({
  workOrderId: z.string().min(1),
  vendorId: z.string().optional(),
  etaMinutes: z.number().int().min(0).optional(),
  reason: z.string().max(500).optional(),
});

app.post('/requests/:id/dispatch', zValidator('json', DispatchSchema), withSecurityEvents({ action: 'maintenance.create', resource: 'maintenance', severity: 'info' }, async (c) => {
  const { userId, tenantId } = auth(c);
  const requestId = c.req.param('id');
  const input = c.req.valid('json');

  // Flip the request status.
  await db(c)
    .update(maintenanceRequests)
    .set({
      status: 'dispatched',
      workOrderId: input.workOrderId,
      dispatchedAt: new Date(),
      updatedAt: new Date(),
      updatedBy: userId,
    })
    .where(
      and(
        eq(maintenanceRequests.id, requestId),
        eq(maintenanceRequests.tenantId, tenantId)
      )
    );

  // Record the dispatch event.
  const repo = new DispatchEventRepository(db(c));
  const event = await repo.create({
    id: uuid(),
    tenantId,
    workOrderId: input.workOrderId,
    vendorId: input.vendorId ?? null,
    dispatchedBy: userId,
    status: 'pending',
    dispatchedAt: new Date(),
    acknowledgedAt: null,
    enRouteAt: null,
    onSiteAt: null,
    completedAt: null,
    cancelledAt: null,
    reason: input.reason ?? null,
    etaMinutes: input.etaMinutes ?? null,
    location: null,
    metadata: {},
  });
  return c.json({ success: true, data: event }, 201);
}));

app.get('/requests/:id/dispatch-events', async (c) => {
  const { tenantId } = auth(c);
  const requestId = c.req.param('id');
  // find associated work order id from the request
  const [req] = await db(c)
    .select()
    .from(maintenanceRequests)
    .where(
      and(
        eq(maintenanceRequests.id, requestId),
        eq(maintenanceRequests.tenantId, tenantId)
      )
    )
    .limit(1);
  if (!req || !req.workOrderId) return c.json({ success: true, data: [] });
  const repo = new DispatchEventRepository(db(c));
  const rows = await repo.listForWorkOrder(req.workOrderId, tenantId);
  return c.json({ success: true, data: rows });
});

// ---------------------------------------------------------------------------
// Completion proofs
// ---------------------------------------------------------------------------

const CompletionSchema = z.object({
  workOrderId: z.string().min(1),
  vendorId: z.string().optional(),
  beforePhotos: z.array(z.object({ url: z.string() })).default([]),
  afterPhotos: z.array(z.object({ url: z.string() })).default([]),
  signature: z
    .object({
      name: z.string(),
      role: z.string(),
      signedAt: z.string(),
    })
    .optional(),
  partsUsed: z
    .array(
      z.object({
        name: z.string(),
        quantity: z.number(),
        unitCostMinor: z.number().optional(),
      })
    )
    .default([]),
  laborHours: z.number().nonnegative().optional(),
  costActualMinor: z.number().int().nonnegative().optional(),
  notes: z.string().max(2_000).optional(),
});

app.post('/requests/:id/complete', zValidator('json', CompletionSchema), withSecurityEvents({ action: 'maintenance.create', resource: 'maintenance', severity: 'info' }, async (c) => {
  const { userId, tenantId } = auth(c);
  const requestId = c.req.param('id');
  const input = c.req.valid('json');

  const repo = new CompletionProofRepository(db(c));
  const proof = await repo.create({
    id: uuid(),
    tenantId,
    workOrderId: input.workOrderId,
    vendorId: input.vendorId ?? null,
    submittedBy: userId,
    beforePhotos: input.beforePhotos,
    afterPhotos: input.afterPhotos,
    signature: input.signature ?? null,
    partsUsed: input.partsUsed,
    laborHours: input.laborHours ?? null,
    costActualMinorUnits: input.costActualMinor ?? null,
    notes: input.notes ?? null,
    verifiedBy: null,
    verifiedAt: null,
    rejectedReason: null,
  });

  // Move request into completed state.
  await db(c)
    .update(maintenanceRequests)
    .set({
      status: 'completed',
      completedAt: new Date(),
      updatedAt: new Date(),
      updatedBy: userId,
    })
    .where(
      and(
        eq(maintenanceRequests.id, requestId),
        eq(maintenanceRequests.tenantId, tenantId)
      )
    );

  return c.json({ success: true, data: proof }, 201);
}));

const VerifyProofSchema = z.object({ notes: z.string().max(2000).optional() });
const RejectProofSchema = z.object({ reason: z.string().min(1).max(1000) });

app.post('/completion-proofs/:id/verify', zValidator('json', VerifyProofSchema), withSecurityEvents({ action: 'maintenance.create', resource: 'maintenance', severity: 'info' }, async (c) => {
  const { userId, tenantId } = auth(c);
  const id = c.req.param('id');
  const repo = new CompletionProofRepository(db(c));
  const row = await repo.verify(id, tenantId, userId);
  if (!row) return c.json({ error: 'not_found' }, 404);
  return c.json({ success: true, data: row });
}));

app.post('/completion-proofs/:id/reject', zValidator('json', RejectProofSchema), withSecurityEvents({ action: 'maintenance.create', resource: 'maintenance', severity: 'info' }, async (c) => {
  const { tenantId } = auth(c);
  const id = c.req.param('id');
  const body = c.req.valid('json');
  const repo = new CompletionProofRepository(db(c));
  const row = await repo.reject(id, tenantId, body.reason);
  if (!row) return c.json({ error: 'not_found' }, 404);
  return c.json({ success: true, data: row });
}));

export const maintenanceRouter = app;
