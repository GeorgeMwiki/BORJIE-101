/**
 * Complaints router — Wave 18 real-data wiring.
 *
 * Top-level complaints surface (the same write surface is also exposed
 * under /feedback/complaints for UX convenience). Persists to
 * `complaint_records` (migration 0092).
 *
 *   POST /                   — create complaint
 *   GET  /                   — tenant-scoped list
 *   GET  /:id                — single complaint
 *   PUT  /:id/resolve        — mark resolved
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';
import { complaintRecords } from '@borjie/database';
import { authMiddleware } from '../middleware/hono-auth';
import { routeCatch } from '../utils/safe-error';

import { withSecurityEvents } from '@borjie/observability';
const createComplaintSchema = z.object({
  subject: z.string().min(1).max(200),
  description: z.string().min(1).max(5000),
  category: z
    .enum(['maintenance', 'neighbor', 'payment', 'lease', 'other'])
    .optional(),
  relatedEntityType: z.string().optional(),
  relatedEntityId: z.string().optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
});

const resolveComplaintSchema = z.object({
  resolution: z.string().min(1).max(2000),
  resolutionNotes: z.string().max(1000).optional(),
});

const app = new Hono();
app.use('*', authMiddleware);

function dbUnavailable(c) {
  return c.json(
    {
      success: false,
      error: {
        code: 'DATABASE_UNAVAILABLE',
        message: 'Complaints requires a live DATABASE_URL.',
      },
    },
    503,
  );
}

function newId(): string {
  return `cmp_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

app.post('/', zValidator('json', createComplaintSchema), withSecurityEvents({ action: 'complaint.create', resource: 'complaint', severity: 'info' }, async (c) => {
  const db = (c.get('services') ?? {}).db;
  if (!db) return dbUnavailable(c);
  const auth = c.get('auth');
  const body = c.req.valid('json');
  try {
    const id = newId();
    await db.insert(complaintRecords).values({
      id,
      tenantId: auth.tenantId,
      userId: auth.userId,
      subject: body.subject,
      description: body.description,
      category: body.category ?? 'other',
      relatedEntityType: body.relatedEntityType,
      relatedEntityId: body.relatedEntityId,
      priority: body.priority,
      status: 'open',
    });
    return c.json({ success: true, data: { id, status: 'open' } }, 201);
  } catch (err) {
    return routeCatch(c, err, {
      code: 'COMPLAINT_WRITE_FAILED',
      status: 503,
      fallback: 'Complaint write failed',
    });
  }
}));

app.get('/', async (c) => {
  const db = (c.get('services') ?? {}).db;
  if (!db) return dbUnavailable(c);
  const tenantId = c.get('tenantId');
  const limit = Math.min(200, Math.max(1, Number(c.req.query('limit') ?? '50') || 50));
  const status = c.req.query('status');
  try {
    const clauses = [eq(complaintRecords.tenantId, tenantId)];
    if (status) clauses.push(eq(complaintRecords.status, status));
    const rows = await db
      .select()
      .from(complaintRecords)
      .where(clauses.length > 1 ? and(...clauses) : clauses[0])
      .orderBy(desc(complaintRecords.createdAt))
      .limit(limit);
    return c.json({ success: true, data: rows });
  } catch (err) {
    return routeCatch(c, err, {
      code: 'COMPLAINTS_QUERY_FAILED',
      status: 503,
      fallback: 'Complaints query failed',
    });
  }
});

app.get('/:id', async (c) => {
  const db = (c.get('services') ?? {}).db;
  if (!db) return dbUnavailable(c);
  const tenantId = c.get('tenantId');
  const id = c.req.param('id');
  try {
    const [row] = await db
      .select()
      .from(complaintRecords)
      .where(
        and(eq(complaintRecords.tenantId, tenantId), eq(complaintRecords.id, id)),
      )
      .limit(1);
    if (!row) {
      return c.json(
        { success: false, error: { code: 'NOT_FOUND', message: 'Complaint not found' } },
        404,
      );
    }
    return c.json({ success: true, data: row });
  } catch (err) {
    return routeCatch(c, err, {
      code: 'COMPLAINT_QUERY_FAILED',
      status: 503,
      fallback: 'Complaint query failed',
    });
  }
});

app.put('/:id/resolve', zValidator('json', resolveComplaintSchema), withSecurityEvents({ action: 'complaint.update', resource: 'complaint', severity: 'info' }, async (c) => {
  const db = (c.get('services') ?? {}).db;
  if (!db) return dbUnavailable(c);
  const auth = c.get('auth');
  const id = c.req.param('id');
  const body = c.req.valid('json');
  try {
    await db
      .update(complaintRecords)
      .set({
        status: 'resolved',
        resolution: body.resolution,
        resolutionNotes: body.resolutionNotes,
        resolvedBy: auth.userId,
        resolvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(complaintRecords.tenantId, auth.tenantId),
          eq(complaintRecords.id, id),
        ),
      );
    return c.json({ success: true, data: { id, status: 'resolved' } });
  } catch (err) {
    return routeCatch(c, err, {
      code: 'COMPLAINT_RESOLVE_FAILED',
      status: 503,
      fallback: 'Complaint resolve failed',
    });
  }
}));

export const complaintsRouter = app;
