/**
 * /api/v1/mining/approvals — unified manager-dispatch approval queue.
 *
 * Per `Docs/research/manager-dispatch-sota.md` §4 (Linear-Triage pattern).
 * A single queue across leave / advance / reassign / fuel / expense /
 * other request kinds. Each row is decided once and immutable (status
 * transition is irreversible).
 *
 * Routes:
 *   GET    /:                              list pending items for the
 *                                          current user as approver.
 *   POST   /:id/approve:                   approve with optional reason.
 *   POST   /:id/reject:                    reject with mandatory reason.
 *   POST   /:id/defer:                     defer with new expiry.
 *
 * Tenant isolation is provided by the RLS GUC on the `db` middleware;
 * routes also pass `tenantId` defensively to every where-clause.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';
import { miningApprovalItems } from '@borjie/database';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';

const APPROVAL_STATUSES = [
  'pending',
  'approved',
  'rejected',
  'deferred',
  'expired',
] as const;

const listQuerySchema = z.object({
  status: z.enum(APPROVAL_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

const approveSchema = z.object({
  reason: z.string().min(1).max(1000).optional(),
});

const rejectSchema = z.object({
  reason: z.string().min(1).max(1000),
});

const deferSchema = z.object({
  reason: z.string().min(1).max(1000).optional(),
  newDueAt: z
    .string()
    .datetime({ offset: true })
    .refine((d) => Date.parse(d) > Date.now(), {
      message: 'newDueAt must be in the future',
    }),
});

const app = new Hono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

// ---------------------------------------------------------------------------
// GET /  — pending approval queue for current user
// ---------------------------------------------------------------------------
app.get('/', async (c) => {
  const { tenantId, userId } = c.get('auth');
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
  const status = parsed.data.status ?? 'pending';
  const limit = parsed.data.limit ?? 100;

  const rows = await db
    .select()
    .from(miningApprovalItems)
    .where(
      and(
        eq(miningApprovalItems.tenantId, tenantId),
        eq(miningApprovalItems.approverUserId, userId),
        eq(miningApprovalItems.status, status),
      ),
    )
    .orderBy(desc(miningApprovalItems.createdAt))
    .limit(Math.min(limit, 500));

  return c.json({ success: true, data: rows }, 200);
});

// ---------------------------------------------------------------------------
// POST /:id/approve
// ---------------------------------------------------------------------------
app.post('/:id/approve', async (c) => {
  const { tenantId, userId } = c.get('auth');
  const db = c.get('db');
  const id = c.req.param('id');
  if (!isUuid(id)) {
    return c.json(
      { success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid id' } },
      400,
    );
  }
  const body = (await c.req.json().catch(() => null)) ?? {};
  const parsed = approveSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid body', issues: parsed.error.issues } },
      400,
    );
  }
  return transition(db, c, tenantId, userId, id, 'approved', parsed.data.reason);
});

// ---------------------------------------------------------------------------
// POST /:id/reject  — mandatory reason
// ---------------------------------------------------------------------------
app.post('/:id/reject', async (c) => {
  const { tenantId, userId } = c.get('auth');
  const db = c.get('db');
  const id = c.req.param('id');
  if (!isUuid(id)) {
    return c.json(
      { success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid id' } },
      400,
    );
  }
  const body = await c.req.json().catch(() => null);
  const parsed = rejectSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { success: false, error: { code: 'VALIDATION_ERROR', message: 'reason is required for reject', issues: parsed.error.issues } },
      400,
    );
  }
  return transition(db, c, tenantId, userId, id, 'rejected', parsed.data.reason);
});

// ---------------------------------------------------------------------------
// POST /:id/defer  — push expiry; status flips to deferred
// ---------------------------------------------------------------------------
app.post('/:id/defer', async (c) => {
  const { tenantId, userId } = c.get('auth');
  const db = c.get('db');
  const id = c.req.param('id');
  if (!isUuid(id)) {
    return c.json(
      { success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid id' } },
      400,
    );
  }
  const body = await c.req.json().catch(() => null);
  const parsed = deferSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid body', issues: parsed.error.issues } },
      400,
    );
  }

  const existing = await loadOwned(db, tenantId, userId, id);
  if ('error' in existing) return c.json(existing.error.body, existing.error.status);
  if (existing.row.status !== 'pending') {
    return c.json(
      { success: false, error: { code: 'INVALID_STATE', message: `Cannot defer item in status ${existing.row.status}` } },
      409,
    );
  }

  const [updated] = await db
    .update(miningApprovalItems)
    .set({
      status: 'deferred',
      decidedAt: new Date(),
      decisionReason: parsed.data.reason ?? null,
      expiresAt: new Date(parsed.data.newDueAt),
    })
    .where(
      and(
        eq(miningApprovalItems.tenantId, tenantId),
        eq(miningApprovalItems.id, id),
      ),
    )
    .returning();

  return c.json({ success: true, data: updated }, 200);
});

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

async function transition(
  db: any,
  c: any,
  tenantId: string,
  userId: string,
  id: string,
  to: 'approved' | 'rejected',
  reason: string | undefined,
): Promise<Response> {
  const existing = await loadOwned(db, tenantId, userId, id);
  if ('error' in existing) {
    return c.json(existing.error.body, existing.error.status);
  }
  if (existing.row.status !== 'pending') {
    return c.json(
      { success: false, error: { code: 'INVALID_STATE', message: `Cannot transition from ${existing.row.status}` } },
      409,
    );
  }
  const [updated] = await db
    .update(miningApprovalItems)
    .set({
      status: to,
      decidedAt: new Date(),
      decisionReason: reason ?? null,
    })
    .where(
      and(
        eq(miningApprovalItems.tenantId, tenantId),
        eq(miningApprovalItems.id, id),
      ),
    )
    .returning();
  return c.json({ success: true, data: updated }, 200);
}

async function loadOwned(
  db: any,
  tenantId: string,
  userId: string,
  id: string,
): Promise<
  | { row: typeof miningApprovalItems.$inferSelect }
  | { error: { body: unknown; status: 404 | 403 } }
> {
  const [row] = await db
    .select()
    .from(miningApprovalItems)
    .where(
      and(
        eq(miningApprovalItems.tenantId, tenantId),
        eq(miningApprovalItems.id, id),
      ),
    )
    .limit(1);
  if (!row) {
    return {
      error: {
        body: { success: false, error: { code: 'NOT_FOUND', message: 'Approval not found' } },
        status: 404,
      },
    };
  }
  if (row.approverUserId !== userId) {
    return {
      error: {
        body: { success: false, error: { code: 'FORBIDDEN', message: 'Only the assigned approver may act' } },
        status: 403,
      },
    };
  }
  return { row };
}

function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    v,
  );
}

export const miningApprovalsRouter = app;
