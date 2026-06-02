/**
 * /api/v1/mining/leave-requests — worker leave (time-off) requests with a
 * SINGLE manager approval (WS-3 workforce wires). NO four-eye.
 *
 * Mirrors the grievance flow (routes/mining/grievances.hono.ts): a worker
 * submits a request, a manager approves or rejects it, and every decision
 * hash-chains an entry into ai_audit_chain (append-only) — exactly like the
 * payroll run audit append in routes/owner/payroll.hono.ts.
 *
 * Routes:
 *   POST  /                 worker submits a leave request (status='pending')
 *   GET   /mine             worker lists THEIR OWN requests, newest first
 *   GET   /                 manager lists the tenant's requests (filter ?status)
 *   POST  /:id/approve      manager approves   (pending -> approved) + audit
 *   POST  /:id/reject       manager rejects    (pending -> rejected) + audit
 *
 * Tenant isolation: RLS FORCE on `leave_requests` (migration 0174).
 * databaseMiddleware binds `app.current_tenant_id`. The worker paths
 * additionally predicate on `worker_user_id = auth.userId`; the manager paths
 * are gated to manager roles. NO money columns — nothing here touches the
 * LedgerService money path.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { and, desc, eq, sql } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';
import { leaveRequests } from '@borjie/database';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { createLogger } from '../../utils/logger';

const moduleLogger = createLogger('mining-leave-requests');

// ---------------------------------------------------------------------------
// Zod schemas (runtime validation — CLAUDE.md hard rule)
// ---------------------------------------------------------------------------

const LEAVE_CATEGORIES = [
  'annual',
  'sick',
  'unpaid',
  'bereavement',
  'maternity',
  'paternity',
  'other',
] as const;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const submitSchema = z
  .object({
    category: z.enum(LEAVE_CATEGORIES).default('annual'),
    startOn: z.string().regex(DATE_RE, 'startOn must be YYYY-MM-DD'),
    endOn: z.string().regex(DATE_RE, 'endOn must be YYYY-MM-DD'),
    reason: z.string().max(2000).optional(),
    siteId: z.string().max(200).optional(),
  })
  .refine((v) => v.endOn >= v.startOn, {
    message: 'endOn must be >= startOn',
    path: ['endOn'],
  });

const decisionSchema = z.object({
  note: z.string().max(2000).optional(),
});

const listQuerySchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected']).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

// ---------------------------------------------------------------------------
// Manager role gate (mining-site manager → PROPERTY_MANAGER; owner/admin too)
// ---------------------------------------------------------------------------

function isManagerOrAbove(role: string | undefined): boolean {
  if (!role) return false;
  return (
    role === 'PROPERTY_MANAGER' ||
    role === 'OWNER' ||
    role === 'TENANT_ADMIN' ||
    role === 'SUPER_ADMIN'
  );
}

// ---------------------------------------------------------------------------
// Audit-chain append (append-only; mirrors owner/payroll.hono.ts)
// ---------------------------------------------------------------------------

interface AuditAppendPayload {
  readonly action: string;
  readonly tenantId: string;
  readonly turnId: string;
  readonly userId: string;
  readonly details: Record<string, unknown>;
}

async function appendAuditEntry(
  db: any,
  payload: AuditAppendPayload,
): Promise<string> {
  const id = randomUUID();
  const canonical = JSON.stringify({
    tenantId: payload.tenantId,
    turnId: payload.turnId,
    action: payload.action,
    userId: payload.userId,
    details: payload.details,
  });
  const latestResult: unknown = await db.execute(
    sql`SELECT COALESCE(MAX(sequence_id), 0) AS max_seq,
               (SELECT this_hash FROM ai_audit_chain
                WHERE tenant_id = ${payload.tenantId}
                ORDER BY sequence_id DESC LIMIT 1) AS last_hash
        FROM ai_audit_chain
        WHERE tenant_id = ${payload.tenantId}`,
  );
  const rows =
    (latestResult as { rows?: ReadonlyArray<Record<string, unknown>> }).rows ??
    (latestResult as ReadonlyArray<Record<string, unknown>>);
  const head = rows[0] ?? {};
  const maxSeq = Number(head.max_seq ?? 0);
  const lastHash =
    typeof head.last_hash === 'string' && head.last_hash.length > 0
      ? head.last_hash
      : '';
  const sequenceId = maxSeq + 1;
  const prevHash = lastHash;
  const thisHash = createHash('sha256')
    .update(prevHash + canonical)
    .digest('hex');
  await db.execute(sql`
    INSERT INTO ai_audit_chain (
      id, tenant_id, sequence_id, turn_id, action,
      prev_hash, this_hash, payload, created_at
    ) VALUES (
      ${id},
      ${payload.tenantId},
      ${sequenceId},
      ${payload.turnId},
      ${payload.action},
      ${prevHash},
      ${thisHash},
      ${JSON.stringify({ userId: payload.userId, details: payload.details })}::jsonb,
      ${new Date().toISOString()}
    )
  `);
  return id;
}

// ---------------------------------------------------------------------------
// Shared decision handler (approve | reject) — single manager sign-off.
// ---------------------------------------------------------------------------

async function handleDecision(
  c: any,
  nextStatus: 'approved' | 'rejected',
  action: string,
) {
  const auth = c.get('auth');
  if (!auth?.userId || !auth?.tenantId) {
    return c.json({ success: false, error: { code: 'UNAUTHORIZED' } }, 401);
  }
  if (!isManagerOrAbove(auth.role)) {
    return c.json({ success: false, error: { code: 'FORBIDDEN' } }, 403);
  }
  const db = c.get('db');
  if (!db) {
    return c.json(
      { success: false, error: { code: 'LEAVE_UNAVAILABLE' } },
      503,
    );
  }
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const parsed = decisionSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      {
        success: false,
        error: { code: 'VALIDATION_ERROR', issues: parsed.error.issues },
      },
      400,
    );
  }

  try {
    const [existing] = await db
      .select()
      .from(leaveRequests)
      .where(
        and(
          eq(leaveRequests.tenantId, auth.tenantId),
          eq(leaveRequests.id, id),
        ),
      )
      .limit(1);
    if (!existing) {
      return c.json(
        { success: false, error: { code: 'LEAVE_NOT_FOUND' } },
        404,
      );
    }
    if (existing.status !== 'pending') {
      return c.json(
        {
          success: false,
          error: {
            code: 'INVALID_STATE',
            message: `Cannot ${nextStatus === 'approved' ? 'approve' : 'reject'} a request in state '${existing.status}'`,
          },
        },
        409,
      );
    }

    const [updated] = await db
      .update(leaveRequests)
      .set({
        status: nextStatus,
        decidedByUserId: auth.userId,
        decidedAt: new Date(),
        decisionNote: parsed.data.note ?? null,
      })
      .where(
        and(
          eq(leaveRequests.tenantId, auth.tenantId),
          eq(leaveRequests.id, id),
          // Optimistic guard: only transition a still-pending row so two
          // concurrent managers can't both decide it.
          eq(leaveRequests.status, 'pending'),
        ),
      )
      .returning();

    if (!updated) {
      // Lost the race — someone decided it between our read and write.
      return c.json(
        {
          success: false,
          error: { code: 'INVALID_STATE', message: 'Request already decided' },
        },
        409,
      );
    }

    // Append-only audit entry for the decision (hash-chained).
    const auditId = await appendAuditEntry(db, {
      action,
      tenantId: auth.tenantId,
      turnId: updated.id,
      userId: auth.userId,
      details: {
        leaveRequestId: updated.id,
        workerUserId: updated.workerUserId,
        decision: nextStatus,
        category: updated.category,
        startOn: updated.startOn,
        endOn: updated.endOn,
      },
    });

    return c.json(
      { success: true, data: updated, meta: { auditId } },
      200,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'decision failed';
    moduleLogger.error('leave request decision failed', {
      evt: 'leave_request_decision_failed',
      tenantId: auth.tenantId,
      leaveRequestId: id,
      decision: nextStatus,
      reason: message,
    });
    return c.json(
      { success: false, error: { code: 'LEAVE_DECISION_FAILED', message } },
      500,
    );
  }
}

// ---------------------------------------------------------------------------
// Router factory
// ---------------------------------------------------------------------------

export function createMiningLeaveRequestsRouter(): Hono {
  const app = new Hono();
  app.use('*', authMiddleware);
  app.use('*', databaseMiddleware);

  // ----------------------------------------------------------------
  // POST / — worker submits a leave request
  // ----------------------------------------------------------------
  app.post('/', async (c: any) => {
    const auth = c.get('auth');
    if (!auth?.userId || !auth?.tenantId) {
      return c.json({ success: false, error: { code: 'UNAUTHORIZED' } }, 401);
    }
    const db = c.get('db');
    if (!db) {
      return c.json(
        { success: false, error: { code: 'LEAVE_UNAVAILABLE' } },
        503,
      );
    }
    const body = await c.req.json().catch(() => null);
    const parsed = submitSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        {
          success: false,
          error: { code: 'VALIDATION_ERROR', issues: parsed.error.issues },
        },
        400,
      );
    }
    const input = parsed.data;

    try {
      const [row] = await db
        .insert(leaveRequests)
        .values({
          id: randomUUID(),
          tenantId: auth.tenantId,
          workerUserId: auth.userId,
          siteId: input.siteId ?? null,
          category: input.category,
          startOn: input.startOn,
          endOn: input.endOn,
          reason: input.reason ?? null,
          status: 'pending',
          submittedAt: new Date(),
        })
        .returning();
      return c.json({ success: true, data: row }, 201);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'submit failed';
      moduleLogger.error('leave request submit failed', {
        evt: 'leave_request_submit_failed',
        tenantId: auth.tenantId,
        reason: message,
      });
      return c.json(
        { success: false, error: { code: 'LEAVE_SUBMIT_FAILED', message } },
        500,
      );
    }
  });

  // ----------------------------------------------------------------
  // GET /mine — worker lists their own requests
  // ----------------------------------------------------------------
  app.get('/mine', async (c: any) => {
    const auth = c.get('auth');
    if (!auth?.userId || !auth?.tenantId) {
      return c.json({ success: false, error: { code: 'UNAUTHORIZED' } }, 401);
    }
    const db = c.get('db');
    if (!db) {
      return c.json(
        { success: false, error: { code: 'LEAVE_UNAVAILABLE' } },
        503,
      );
    }
    const parsedQuery = listQuerySchema.safeParse({
      status: c.req.query('status'),
      limit: c.req.query('limit'),
    });
    if (!parsedQuery.success) {
      return c.json(
        {
          success: false,
          error: { code: 'VALIDATION_ERROR', issues: parsedQuery.error.issues },
        },
        400,
      );
    }
    const { status, limit } = parsedQuery.data;
    try {
      const conds = [
        eq(leaveRequests.tenantId, auth.tenantId),
        eq(leaveRequests.workerUserId, auth.userId),
      ];
      if (status) conds.push(eq(leaveRequests.status, status));
      const rows = await db
        .select()
        .from(leaveRequests)
        .where(and(...conds))
        .orderBy(desc(leaveRequests.submittedAt))
        .limit(limit ?? 100);
      return c.json({ success: true, data: rows }, 200);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'list failed';
      return c.json(
        { success: false, error: { code: 'LEAVE_LIST_FAILED', message } },
        500,
      );
    }
  });

  // ----------------------------------------------------------------
  // GET / — manager lists the tenant's requests (triage queue)
  // ----------------------------------------------------------------
  app.get('/', async (c: any) => {
    const auth = c.get('auth');
    if (!auth?.userId || !auth?.tenantId) {
      return c.json({ success: false, error: { code: 'UNAUTHORIZED' } }, 401);
    }
    if (!isManagerOrAbove(auth.role)) {
      return c.json({ success: false, error: { code: 'FORBIDDEN' } }, 403);
    }
    const db = c.get('db');
    if (!db) {
      return c.json(
        { success: false, error: { code: 'LEAVE_UNAVAILABLE' } },
        503,
      );
    }
    const parsedQuery = listQuerySchema.safeParse({
      status: c.req.query('status'),
      limit: c.req.query('limit'),
    });
    if (!parsedQuery.success) {
      return c.json(
        {
          success: false,
          error: { code: 'VALIDATION_ERROR', issues: parsedQuery.error.issues },
        },
        400,
      );
    }
    const { status, limit } = parsedQuery.data;
    try {
      const conds = [eq(leaveRequests.tenantId, auth.tenantId)];
      if (status) conds.push(eq(leaveRequests.status, status));
      const rows = await db
        .select()
        .from(leaveRequests)
        .where(and(...conds))
        .orderBy(desc(leaveRequests.submittedAt))
        .limit(limit ?? 100);
      return c.json({ success: true, data: rows }, 200);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'list failed';
      return c.json(
        { success: false, error: { code: 'LEAVE_LIST_FAILED', message } },
        500,
      );
    }
  });

  // ----------------------------------------------------------------
  // POST /:id/approve — manager approves (single sign-off) + audit append
  // ----------------------------------------------------------------
  app.post('/:id/approve', (c: any) =>
    handleDecision(c, 'approved', 'mining.leave.approve'),
  );

  // ----------------------------------------------------------------
  // POST /:id/reject — manager rejects (single sign-off) + audit append
  // ----------------------------------------------------------------
  app.post('/:id/reject', (c: any) =>
    handleDecision(c, 'rejected', 'mining.leave.reject'),
  );

  return app;
}

export const miningLeaveRequestsRouter = createMiningLeaveRequestsRouter();
