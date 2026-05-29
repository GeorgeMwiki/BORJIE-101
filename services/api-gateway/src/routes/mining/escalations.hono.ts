/**
 * /api/v1/mining/escalations — manager-dispatch escalation chain.
 *
 * Per `Docs/research/manager-dispatch-sota.md` §9. Workers raise to
 * managers, managers raise up to owners, owners broadcast to roles.
 *
 * Routes:
 *   GET    /:                              list open escalations the
 *                                          current user raised or is
 *                                          addressed by (specific or
 *                                          role-broadcast).
 *   POST   /:                              raise a new escalation
 *                                          (any authenticated role).
 *   POST   /:id/acknowledge:               mark acknowledged (addressee only).
 *   POST   /:id/resolve:                   close (raiser or addressee).
 *
 * Tenant isolation is provided by the RLS GUC on the `db` middleware;
 * routes also pass `tenantId` defensively to every where-clause.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { and, desc, eq, or } from 'drizzle-orm';
import { miningEscalations } from '@borjie/database';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { publishCockpitEvent } from '../../services/cockpit-events';

const ESCALATION_SOURCE_KINDS = [
  'incident',
  'task',
  'crew',
  'production',
  'safety',
] as const;

const ESCALATION_SEVERITIES = ['info', 'warning', 'critical'] as const;

const ESCALATION_STATUSES = ['open', 'acknowledged', 'resolved'] as const;

const createEscalationSchema = z
  .object({
    toUserId: z.string().uuid().optional(),
    toRole: z.string().min(1).max(64).optional(),
    sourceKind: z.enum(ESCALATION_SOURCE_KINDS),
    sourceId: z.string().uuid().optional(),
    contextSw: z.string().min(1).max(2000),
    severity: z.enum(ESCALATION_SEVERITIES).default('warning'),
  })
  .refine(
    (input) =>
      (input.toUserId && !input.toRole) || (!input.toUserId && input.toRole),
    {
      message: 'Either toUserId or toRole must be set (exclusive)',
      path: ['toUserId'],
    },
  );

const listQuerySchema = z.object({
  status: z.enum(ESCALATION_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

// Plain Hono so we don't touch the shared OpenAPI route-defs file
// (owned by other waves). Mounted at /mining/escalations in
// `routes/mining/index.ts`.
const app = new Hono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

// ---------------------------------------------------------------------------
// GET /  — inbox + outbox for current user (raised or addressed-to-me)
// ---------------------------------------------------------------------------
app.get('/', async (c) => {
  const { tenantId, userId, role } = c.get('auth');
  const db = c.get('db');
  const parsed = listQuerySchema.safeParse({
    status: c.req.query('status'),
    limit: c.req.query('limit'),
  });
  if (!parsed.success) {
    return c.json(
      { success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid query', issues: parsed.error.issues } },
      400,
    );
  }
  const { status, limit } = parsed.data;
  const conds = [eq(miningEscalations.tenantId, tenantId)];
  if (status) conds.push(eq(miningEscalations.status, status));
  const addressee = or(
    eq(miningEscalations.raisedByUserId, userId),
    eq(miningEscalations.toUserId, userId),
    eq(miningEscalations.toRole, role),
  );
  if (addressee) conds.push(addressee);

  const rows = await db
    .select()
    .from(miningEscalations)
    .where(and(...conds))
    .orderBy(desc(miningEscalations.createdAt))
    .limit(Math.min(limit ?? 100, 500));

  return c.json({ success: true, data: rows }, 200);
});

// ---------------------------------------------------------------------------
// POST /  — raise a new escalation
// ---------------------------------------------------------------------------
app.post('/', async (c) => {
  const { tenantId, userId } = c.get('auth');
  const db = c.get('db');
  const body = await c.req.json().catch(() => null);
  const parsed = createEscalationSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid body', issues: parsed.error.issues } },
      400,
    );
  }
  const input = parsed.data;
  const [row] = await db
    .insert(miningEscalations)
    .values({
      tenantId,
      raisedByUserId: userId,
      toUserId: input.toUserId ?? null,
      toRole: input.toRole ?? null,
      sourceKind: input.sourceKind,
      sourceId: input.sourceId ?? null,
      contextSw: input.contextSw,
      severity: input.severity,
      status: 'open',
    })
    .returning();
  // RT-1: pulse the addressee surface so it lights up immediately.
  if (row) {
    setImmediate(() => {
      try {
        publishCockpitEvent({
          kind: 'incident.escalated',
          tenantId,
          emittedAt: new Date().toISOString(),
          incidentId: row.id,
          fromLevel: 'worker',
          toLevel: input.toUserId ? 'user' : `role:${input.toRole ?? 'unknown'}`,
          escalatedBy: userId,
        });
      } catch {
        // bus failures must never leak to the request response.
      }
    });
  }
  return c.json({ success: true, data: row }, 201);
});

// ---------------------------------------------------------------------------
// POST /:id/acknowledge  — addressee marks as acknowledged
// ---------------------------------------------------------------------------
app.post('/:id/acknowledge', async (c) => {
  const { tenantId, userId, role } = c.get('auth');
  const db = c.get('db');
  const id = c.req.param('id');
  if (!isUuid(id)) {
    return c.json(
      { success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid id' } },
      400,
    );
  }

  const [existing] = await db
    .select()
    .from(miningEscalations)
    .where(and(eq(miningEscalations.tenantId, tenantId), eq(miningEscalations.id, id)))
    .limit(1);

  if (!existing) {
    return c.json(
      { success: false, error: { code: 'NOT_FOUND', message: 'Escalation not found' } },
      404,
    );
  }

  const isAddressee =
    existing.toUserId === userId || (existing.toRole !== null && existing.toRole === role);
  if (!isAddressee) {
    return c.json(
      { success: false, error: { code: 'FORBIDDEN', message: 'Only addressee may acknowledge' } },
      403,
    );
  }

  // Idempotent: already acknowledged returns current row.
  if (existing.status !== 'open') {
    return c.json({ success: true, data: existing }, 200);
  }

  const [updated] = await db
    .update(miningEscalations)
    .set({ status: 'acknowledged', acknowledgedAt: new Date() })
    .where(and(eq(miningEscalations.tenantId, tenantId), eq(miningEscalations.id, id)))
    .returning();

  return c.json({ success: true, data: updated }, 200);
});

// ---------------------------------------------------------------------------
// POST /:id/resolve  — raiser or addressee closes the escalation
// ---------------------------------------------------------------------------
app.post('/:id/resolve', async (c) => {
  const { tenantId, userId, role } = c.get('auth');
  const db = c.get('db');
  const id = c.req.param('id');
  if (!isUuid(id)) {
    return c.json(
      { success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid id' } },
      400,
    );
  }

  const [existing] = await db
    .select()
    .from(miningEscalations)
    .where(and(eq(miningEscalations.tenantId, tenantId), eq(miningEscalations.id, id)))
    .limit(1);

  if (!existing) {
    return c.json(
      { success: false, error: { code: 'NOT_FOUND', message: 'Escalation not found' } },
      404,
    );
  }

  const isAllowed =
    existing.raisedByUserId === userId ||
    existing.toUserId === userId ||
    (existing.toRole !== null && existing.toRole === role);
  if (!isAllowed) {
    return c.json(
      { success: false, error: { code: 'FORBIDDEN', message: 'Only raiser or addressee may resolve' } },
      403,
    );
  }

  // Idempotent.
  if (existing.status === 'resolved') {
    return c.json({ success: true, data: existing }, 200);
  }

  const [updated] = await db
    .update(miningEscalations)
    .set({ status: 'resolved', resolvedAt: new Date() })
    .where(and(eq(miningEscalations.tenantId, tenantId), eq(miningEscalations.id, id)))
    .returning();

  return c.json({ success: true, data: updated }, 200);
});

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    v,
  );
}

export const miningEscalationsRouter = app;
