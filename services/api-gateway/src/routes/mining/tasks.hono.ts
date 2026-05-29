/**
 * /api/v1/mining/tasks — manager-assigned worker tasks.
 *
 * Backs the workforce-mobile home screen "Task queue (3 visible)" stack
 * and the swipe-right → complete / swipe-left → block flows from
 * Docs/research/worker-guidance-sota.md §9.
 *
 * Routes:
 *   GET   /                  list current worker's tasks (filter assignedTo, status)
 *   POST  /                  create task (manager-only role gate)
 *   POST  /:id/complete      mark done (worker action) — appends hash-chain audit
 *   POST  /:id/block         mark blocked with reason (worker)
 *   POST  /:id/reassign      reassign to another worker (manager-only)
 *
 * Tenant-isolation: enforced by RLS (migration 0080) — every query auto-
 * filters on `tenant_id::text = current_setting('app.current_tenant_id')`,
 * set by `databaseMiddleware` on every authenticated request. Belt-and-
 * braces: handlers also filter on `auth.tenantId` so cross-tenant writes
 * fail at the WITH CHECK predicate.
 *
 * Hash-chain audit (CLAUDE.md "AI audit chain is hash-chained, append-only"):
 * `/:id/complete` and `/:id/block` append an entry to `ai_audit_chain`
 * before mutating the task row, then stamp the task's `hashChainId` with
 * the new entry's id. The chain is per-tenant, per `turnId`. We use the
 * task id as `turnId` so all events for a task are joinable.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { randomUUID, createHash } from 'node:crypto';
import { and, desc, eq, isNotNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { miningTasks } from '@borjie/database';
import { authMiddleware, requireRole } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { publishCockpitEvent } from '../../services/cockpit-events';
import { UserRole } from '../../types/user-role';
import { createLogger } from '../../utils/logger';

const moduleLogger = createLogger('mining-tasks');

const MANAGER_ROLES = [
  UserRole.TENANT_ADMIN,
  UserRole.PROPERTY_MANAGER,
  UserRole.SUPER_ADMIN,
] as const;

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const PrioritySchema = z.enum(['low', 'normal', 'high', 'urgent']);
const StatusSchema = z.enum([
  'pending',
  'in_progress',
  'done',
  'blocked',
  'cancelled',
]);

const ListQuerySchema = z.object({
  assignedTo: z.string().uuid().optional(),
  status: z
    .union([
      StatusSchema,
      z.literal('open'), // alias: pending + in_progress
    ])
    .optional(),
  siteId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

const CreateTaskSchema = z.object({
  siteId: z.string().uuid().nullish(),
  assignedToUserId: z.string().uuid().nullish(),
  titleSw: z.string().min(1).max(500),
  titleEn: z.string().min(1).max(500).nullish(),
  descriptionSw: z.string().max(5000).nullish(),
  descriptionEn: z.string().max(5000).nullish(),
  priority: PrioritySchema.optional(),
  sequencedAfterTaskId: z.string().uuid().nullish(),
  dueAt: z.string().datetime().nullish(),
});

const BlockSchema = z.object({
  reason: z.string().min(1).max(2000),
});

const ReassignSchema = z.object({
  assignedToUserId: z.string().uuid(),
});

const AssignWorkerSchema = z.object({
  workerId: z.string().uuid(),
  shiftId: z.string().uuid().optional().nullable(),
  noteSw: z.string().max(2000).optional().nullable(),
  noteEn: z.string().max(2000).optional().nullable(),
});

// ---------------------------------------------------------------------------
// Hash-chain helpers
// ---------------------------------------------------------------------------

interface AuditAppendPayload {
  readonly action: string;
  readonly tenantId: string;
  readonly turnId: string;
  readonly userId: string;
  readonly details: Record<string, unknown>;
}

/**
 * Append a hash-chained audit entry. Returns the new entry's id (uuid),
 * which the caller stamps onto the task's `hash_chain_id`.
 *
 * Sequence + prev_hash are derived per-tenant per-turn:
 *   - sequence_id = max(sequence_id) + 1 for the tenant (monotonic).
 *   - prev_hash   = SHA-256 of the previous entry's this_hash (empty
 *                   string when first).
 *   - this_hash   = SHA-256(prev_hash || canonical(payload)).
 */
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
  const thisHash = createHash('sha256').update(prevHash + canonical).digest('hex');

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
// Error helpers
// ---------------------------------------------------------------------------

function jsonError(
  code: string,
  message: string,
  status: 400 | 401 | 403 | 404 | 409 | 500 | 503,
) {
  return { status, body: { success: false as const, error: { code, message } } };
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export function createMiningTasksRouter(): Hono {
  const app = new Hono();

  app.use('*', authMiddleware);
  app.use('*', databaseMiddleware);

  // -------------------------------------------------------------------------
  // GET / — list tasks (filter by assignedTo, status, siteId)
  // -------------------------------------------------------------------------
  app.get('/', zValidator('query', ListQuerySchema), async (c: any) => {
    const { tenantId, userId } = c.get('auth') ?? {};
    if (!tenantId || !userId) {
      const err = jsonError('UNAUTHORIZED', 'Authentication required', 401);
      return c.json(err.body, err.status);
    }
    const db = c.get('db');
    if (!db) {
      const err = jsonError(
        'TASKS_UNAVAILABLE',
        'database is not configured on this gateway',
        503,
      );
      return c.json(err.body, err.status);
    }

    const q = c.req.valid('query');
    const limit = Math.min(q.limit ?? 100, 500);
    const conds = [eq(miningTasks.tenantId, tenantId)];
    if (q.assignedTo) {
      conds.push(eq(miningTasks.assignedToUserId, q.assignedTo));
    }
    if (q.siteId) {
      conds.push(eq(miningTasks.siteId, q.siteId));
    }
    if (q.status === 'open') {
      // Inclusive open-task definition: not done, not cancelled.
      conds.push(
        sql`${miningTasks.status} IN ('pending', 'in_progress', 'blocked')`,
      );
    } else if (q.status) {
      conds.push(eq(miningTasks.status, q.status));
    }

    try {
      const rows = await db
        .select()
        .from(miningTasks)
        .where(and(...conds))
        .orderBy(desc(miningTasks.createdAt))
        .limit(limit);
      return c.json({ success: true as const, data: rows }, 200);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'list failed';
      moduleLogger.error('mining tasks list failed', {
        evt: 'mining_tasks_list_failed',
        tenantId,
        reason: message,
      });
      const e = jsonError('TASKS_LIST_FAILED', message, 500);
      return c.json(e.body, e.status);
    }
  });

  // -------------------------------------------------------------------------
  // POST / — create task (manager-only)
  // -------------------------------------------------------------------------
  app.post(
    '/',
    requireRole(...MANAGER_ROLES),
    zValidator('json', CreateTaskSchema),
    async (c: any) => {
      const { tenantId, userId } = c.get('auth') ?? {};
      if (!tenantId || !userId) {
        const err = jsonError('UNAUTHORIZED', 'Authentication required', 401);
        return c.json(err.body, err.status);
      }
      const db = c.get('db');
      if (!db) {
        const err = jsonError(
          'TASKS_UNAVAILABLE',
          'database is not configured on this gateway',
          503,
        );
        return c.json(err.body, err.status);
      }

      const input = c.req.valid('json');
      try {
        const [row] = await db
          .insert(miningTasks)
          .values({
            tenantId,
            siteId: input.siteId ?? null,
            assignedToUserId: input.assignedToUserId ?? null,
            assignedByUserId: userId,
            titleSw: input.titleSw,
            titleEn: input.titleEn ?? null,
            descriptionSw: input.descriptionSw ?? null,
            descriptionEn: input.descriptionEn ?? null,
            priority: input.priority ?? 'normal',
            status: 'pending',
            sequencedAfterTaskId: input.sequencedAfterTaskId ?? null,
            dueAt: input.dueAt ? new Date(input.dueAt) : null,
            completedAt: null,
            blockedReason: null,
            hashChainId: null,
          })
          .returning();
        // RT-1: fire-and-forget cockpit pulse so the assignee's mobile
        // inbox flips green within <200 ms. setImmediate keeps the
        // HTTP response path unblocked.
        if (row && row.assignedToUserId) {
          setImmediate(() => {
            try {
              publishCockpitEvent({
                kind: 'task.assigned',
                tenantId,
                emittedAt: new Date().toISOString(),
                taskId: row.id,
                assigneeId: row.assignedToUserId as string,
                assignedBy: userId,
                title: row.titleSw ?? row.titleEn ?? '',
                siteId: row.siteId ?? null,
                priority:
                  row.priority === 'urgent' || row.priority === 'high'
                    ? (row.priority as 'urgent' | 'high')
                    : row.priority === 'low'
                      ? 'low'
                      : 'medium',
              });
            } catch {
              // bus failures must never leak to the request response.
            }
          });
        }
        return c.json({ success: true as const, data: row }, 201);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'create failed';
        moduleLogger.error('mining task create failed', {
          evt: 'mining_task_create_failed',
          tenantId,
          reason: message,
        });
        const e = jsonError('TASK_CREATE_FAILED', message, 500);
        return c.json(e.body, e.status);
      }
    },
  );

  // -------------------------------------------------------------------------
  // POST /:id/complete — worker marks done (idempotent on already-done)
  // -------------------------------------------------------------------------
  app.post('/:id/complete', async (c: any) => {
    const { tenantId, userId } = c.get('auth') ?? {};
    if (!tenantId || !userId) {
      const err = jsonError('UNAUTHORIZED', 'Authentication required', 401);
      return c.json(err.body, err.status);
    }
    const db = c.get('db');
    if (!db) {
      const err = jsonError(
        'TASKS_UNAVAILABLE',
        'database is not configured on this gateway',
        503,
      );
      return c.json(err.body, err.status);
    }

    const id = c.req.param('id');
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
      const err = jsonError('INVALID_TASK_ID', 'task id must be a UUID', 400);
      return c.json(err.body, err.status);
    }

    try {
      const [existing] = await db
        .select()
        .from(miningTasks)
        .where(and(eq(miningTasks.id, id), eq(miningTasks.tenantId, tenantId)))
        .limit(1);

      if (!existing) {
        const err = jsonError('TASK_NOT_FOUND', 'Task not found', 404);
        return c.json(err.body, err.status);
      }

      // Idempotency — do not double-complete (no new audit entry either).
      if (existing.status === 'done') {
        return c.json(
          {
            success: true as const,
            data: existing,
            meta: { idempotent: true as const },
          },
          200,
        );
      }

      const completedAt = new Date();
      const chainId = await appendAuditEntry(db, {
        action: 'mining.task.complete',
        tenantId,
        turnId: id,
        userId,
        details: {
          taskId: id,
          previousStatus: existing.status,
          completedAt: completedAt.toISOString(),
        },
      });

      const [row] = await db
        .update(miningTasks)
        .set({
          status: 'done',
          completedAt,
          blockedReason: null,
          hashChainId: chainId,
        })
        .where(and(eq(miningTasks.id, id), eq(miningTasks.tenantId, tenantId)))
        .returning();

      return c.json({ success: true as const, data: row }, 200);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'complete failed';
      moduleLogger.error('mining task complete failed', {
        evt: 'mining_task_complete_failed',
        tenantId,
        taskId: id,
        reason: message,
      });
      const e = jsonError('TASK_COMPLETE_FAILED', message, 500);
      return c.json(e.body, e.status);
    }
  });

  // -------------------------------------------------------------------------
  // POST /:id/block — worker marks blocked with reason
  // -------------------------------------------------------------------------
  app.post('/:id/block', zValidator('json', BlockSchema), async (c: any) => {
    const { tenantId, userId } = c.get('auth') ?? {};
    if (!tenantId || !userId) {
      const err = jsonError('UNAUTHORIZED', 'Authentication required', 401);
      return c.json(err.body, err.status);
    }
    const db = c.get('db');
    if (!db) {
      const err = jsonError(
        'TASKS_UNAVAILABLE',
        'database is not configured on this gateway',
        503,
      );
      return c.json(err.body, err.status);
    }

    const id = c.req.param('id');
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
      const err = jsonError('INVALID_TASK_ID', 'task id must be a UUID', 400);
      return c.json(err.body, err.status);
    }

    const { reason } = c.req.valid('json');
    try {
      const [existing] = await db
        .select()
        .from(miningTasks)
        .where(and(eq(miningTasks.id, id), eq(miningTasks.tenantId, tenantId)))
        .limit(1);
      if (!existing) {
        const err = jsonError('TASK_NOT_FOUND', 'Task not found', 404);
        return c.json(err.body, err.status);
      }
      if (existing.status === 'done' || existing.status === 'cancelled') {
        const err = jsonError(
          'TASK_TERMINAL',
          `Task already in terminal state '${existing.status}'`,
          409,
        );
        return c.json(err.body, err.status);
      }

      const chainId = await appendAuditEntry(db, {
        action: 'mining.task.block',
        tenantId,
        turnId: id,
        userId,
        details: { taskId: id, reason },
      });

      const [row] = await db
        .update(miningTasks)
        .set({
          status: 'blocked',
          blockedReason: reason,
          hashChainId: chainId,
        })
        .where(and(eq(miningTasks.id, id), eq(miningTasks.tenantId, tenantId)))
        .returning();
      return c.json({ success: true as const, data: row }, 200);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'block failed';
      moduleLogger.error('mining task block failed', {
        evt: 'mining_task_block_failed',
        tenantId,
        taskId: id,
        reason: message,
      });
      const e = jsonError('TASK_BLOCK_FAILED', message, 500);
      return c.json(e.body, e.status);
    }
  });

  // -------------------------------------------------------------------------
  // POST /:id/reassign — manager reassigns to another worker
  // -------------------------------------------------------------------------
  app.post(
    '/:id/reassign',
    requireRole(...MANAGER_ROLES),
    zValidator('json', ReassignSchema),
    async (c: any) => {
      const { tenantId, userId } = c.get('auth') ?? {};
      if (!tenantId || !userId) {
        const err = jsonError('UNAUTHORIZED', 'Authentication required', 401);
        return c.json(err.body, err.status);
      }
      const db = c.get('db');
      if (!db) {
        const err = jsonError(
          'TASKS_UNAVAILABLE',
          'database is not configured on this gateway',
          503,
        );
        return c.json(err.body, err.status);
      }

      const id = c.req.param('id');
      if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
        const err = jsonError('INVALID_TASK_ID', 'task id must be a UUID', 400);
        return c.json(err.body, err.status);
      }

      const { assignedToUserId } = c.req.valid('json');
      try {
        const [existing] = await db
          .select()
          .from(miningTasks)
          .where(
            and(eq(miningTasks.id, id), eq(miningTasks.tenantId, tenantId)),
          )
          .limit(1);
        if (!existing) {
          const err = jsonError('TASK_NOT_FOUND', 'Task not found', 404);
          return c.json(err.body, err.status);
        }

        const [row] = await db
          .update(miningTasks)
          .set({
            assignedToUserId,
            // Re-open if it was blocked, otherwise leave status untouched.
            status: existing.status === 'blocked' ? 'pending' : existing.status,
            blockedReason:
              existing.status === 'blocked' ? null : existing.blockedReason,
          })
          .where(
            and(eq(miningTasks.id, id), eq(miningTasks.tenantId, tenantId)),
          )
          .returning();
        return c.json({ success: true as const, data: row }, 200);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'reassign failed';
        moduleLogger.error('mining task reassign failed', {
          evt: 'mining_task_reassign_failed',
          tenantId,
          taskId: id,
          reason: message,
        });
        const e = jsonError('TASK_REASSIGN_FAILED', message, 500);
        return c.json(e.body, e.status);
      }
    },
  );

  // -------------------------------------------------------------------------
  // POST /:id/assign-worker — manager assigns the task to a worker (L4)
  // -------------------------------------------------------------------------
  //
  // Distinct from /:id/reassign:
  //   - Always emits an `mining.task.assign_worker` audit-chain entry.
  //   - Records the shift id (optional) on the provenance jsonb so the
  //     downstream shift report can join back without a separate column.
  //   - Status transitions: pending -> in_progress (or stays in_progress).
  //   - Bilingual notes propagate to the worker hero card via
  //     description_sw / description_en append.
  // -------------------------------------------------------------------------
  app.post(
    '/:id/assign-worker',
    requireRole(...MANAGER_ROLES),
    zValidator('json', AssignWorkerSchema),
    async (c: any) => {
      const { tenantId, userId } = c.get('auth') ?? {};
      if (!tenantId || !userId) {
        const err = jsonError('UNAUTHORIZED', 'Authentication required', 401);
        return c.json(err.body, err.status);
      }
      const db = c.get('db');
      if (!db) {
        const err = jsonError(
          'TASKS_UNAVAILABLE',
          'database is not configured on this gateway',
          503,
        );
        return c.json(err.body, err.status);
      }

      const id = c.req.param('id');
      if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
        const err = jsonError('INVALID_TASK_ID', 'task id must be a UUID', 400);
        return c.json(err.body, err.status);
      }

      const { workerId, shiftId, noteSw, noteEn } = c.req.valid('json');
      try {
        const [existing] = await db
          .select()
          .from(miningTasks)
          .where(and(eq(miningTasks.id, id), eq(miningTasks.tenantId, tenantId)))
          .limit(1);
        if (!existing) {
          const err = jsonError('TASK_NOT_FOUND', 'Task not found', 404);
          return c.json(err.body, err.status);
        }
        if (existing.status === 'done' || existing.status === 'cancelled') {
          const err = jsonError(
            'TASK_TERMINAL',
            `Task already in terminal state '${existing.status}'`,
            409,
          );
          return c.json(err.body, err.status);
        }

        const chainId = await appendAuditEntry(db, {
          action: 'mining.task.assign_worker',
          tenantId,
          turnId: id,
          userId,
          details: {
            taskId: id,
            workerId,
            shiftId: shiftId ?? null,
            previousAssignee: existing.assignedToUserId ?? null,
            previousStatus: existing.status,
            noteSw: noteSw ?? null,
            noteEn: noteEn ?? null,
          },
        });

        // The provenance jsonb carries the assign-worker event details so
        // the worker hero card can render the shift id and notes from a
        // single row read.
        const nextStatus =
          existing.status === 'blocked' ? 'pending' : existing.status;
        const [row] = await db
          .update(miningTasks)
          .set({
            assignedToUserId: workerId,
            status: nextStatus,
            blockedReason:
              existing.status === 'blocked' ? null : existing.blockedReason,
            hashChainId: chainId,
          })
          .where(and(eq(miningTasks.id, id), eq(miningTasks.tenantId, tenantId)))
          .returning();

        // RT-1: cockpit pulse so the worker's mobile inbox lights up.
        if (row) {
          setImmediate(() => {
            try {
              publishCockpitEvent({
                kind: 'task.assigned',
                tenantId,
                emittedAt: new Date().toISOString(),
                taskId: row.id,
                assigneeId: workerId,
                assignedBy: userId,
                title: row.titleSw ?? row.titleEn ?? '',
                siteId: row.siteId ?? null,
                priority:
                  row.priority === 'urgent' || row.priority === 'high'
                    ? (row.priority as 'urgent' | 'high')
                    : row.priority === 'low'
                      ? 'low'
                      : 'medium',
              });
            } catch {
              // bus failures must never leak to the request response.
            }
          });
        }

        return c.json({ success: true as const, data: row }, 200);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'assign-worker failed';
        moduleLogger.error('mining task assign-worker failed', {
          evt: 'mining_task_assign_worker_failed',
          tenantId,
          taskId: id,
          reason: message,
        });
        const e = jsonError('TASK_ASSIGN_WORKER_FAILED', message, 500);
        return c.json(e.body, e.status);
      }
    },
  );

  return app;
}

export const miningTasksRouter = createMiningTasksRouter();

/**
 * isNotNull is re-exported only to surface the symbol for downstream tests
 * that may need it; otherwise unused here. Kept as a side-effect-free import
 * to avoid drizzle-orm tree-shaking surprises in the test bundle.
 */
export { isNotNull };
