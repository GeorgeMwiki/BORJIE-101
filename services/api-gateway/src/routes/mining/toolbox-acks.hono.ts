/**
 * /api/v1/mining/toolbox-acks — generic offline-sync acknowledgement sink.
 *
 * Closes finding `wm-toolbox-ack-404`. The workforce-mobile offline write
 * queue enqueues `entityType='toolbox_ack'` for two distinct worker actions
 * and flushes them to `POST /api/v1/mining/toolbox-acks`
 * (`endpointFor('toolbox_ack')` = kebab+s). Before this router no such route
 * existed: every flush hit a 404, the sync layer classifies 404 as terminal
 * (flush.ts `shouldDrop`), and the queued entry was dropped on the FIRST
 * attempt — the worker's task completion / talk sign-off was permanently and
 * silently lost.
 *
 * GENERATIVE shape (not a per-verb one-off): the body carries a `kind`
 * discriminator and the route DISPATCHES to the right domain table. A new
 * ack kind only needs a new branch here — the mobile sync layer, the endpoint,
 * and the envelope stay stable.
 *
 *   POST /            { kind, targetId|taskId|talkId, userId?, at? }
 *     kind='task_complete' → mark the mining_tasks row done (mirrors the
 *                            B-WorkerTasks `/tasks/:id/complete` semantics:
 *                            hash-chained audit append + idempotent on
 *                            already-done + cockpit close-the-loop pulse).
 *     kind='talk_ack'      → append the caller to a toolbox-talk's
 *                            `acknowledgedByUserIds` (idempotent on
 *                            already-acked), mirroring
 *                            `/toolbox-talks/:id/acknowledge`.
 *
 * Identity (tenant + user) is taken from `c.get('auth')` ONLY — the body's
 * optional `userId` is advisory provenance and is NEVER trusted for the
 * acknowledging principal. Tenant scope is bound by `databaseMiddleware`'s
 * `app.current_tenant_id` GUC (RLS FORCE); handlers also predicate on
 * `auth.tenantId` (belt-and-braces against the WITH CHECK).
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { randomUUID, createHash } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { miningTasks, miningToolboxTalks } from '@borjie/database';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { publishCockpitEvent } from '../../services/cockpit-events';
import { createLogger } from '../../utils/logger';

const moduleLogger = createLogger('mining-toolbox-acks');

const UUID_RE = /^[0-9a-f-]{36}$/i;

// ---------------------------------------------------------------------------
// Body schema — the queued payload sends `taskId` (task_complete) and may use
// `targetId`/`talkId`. Accept all three and resolve a single targetId so the
// route stays generative and matches the live mobile producer.
// ---------------------------------------------------------------------------

const AckBodySchema = z
  .object({
    kind: z.enum(['task_complete', 'talk_ack']),
    targetId: z.string().min(1).max(64).optional(),
    taskId: z.string().min(1).max(64).optional(),
    talkId: z.string().min(1).max(64).optional(),
    userId: z.string().min(1).max(64).optional(),
    at: z.number().int().nonnegative().optional(),
  })
  .strict()
  .refine((v) => Boolean(v.targetId ?? v.taskId ?? v.talkId), {
    message: 'one of targetId | taskId | talkId is required',
  });

function jsonError(
  code: string,
  message: string,
  status: 400 | 401 | 403 | 404 | 409 | 500 | 503,
) {
  return { status, body: { success: false as const, error: { code, message } } };
}

// ---------------------------------------------------------------------------
// Hash-chain audit append — identical algorithm to the B-WorkerTasks router so
// a task closed via the offline-sync ack is forensically indistinguishable
// from one closed via the foreground `/tasks/:id/complete` call.
// ---------------------------------------------------------------------------

interface AuditAppendPayload {
  readonly action: string;
  readonly tenantId: string;
  readonly turnId: string;
  readonly userId: string;
  readonly details: Record<string, unknown>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  const thisHash = createHash('sha256')
    .update(lastHash + canonical)
    .digest('hex');
  await db.execute(sql`
    INSERT INTO ai_audit_chain (
      id, tenant_id, sequence_id, turn_id, action,
      prev_hash, this_hash, payload, created_at
    ) VALUES (
      ${id}, ${payload.tenantId}, ${sequenceId}, ${payload.turnId},
      ${payload.action}, ${lastHash}, ${thisHash},
      ${JSON.stringify({ userId: payload.userId, details: payload.details })}::jsonb,
      ${new Date().toISOString()}
    )
  `);
  return id;
}

// ---------------------------------------------------------------------------
// Dispatch helpers — one per ack kind. Each returns a `{ status, body }`.
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function completeTask(
  db: any,
  tenantId: string,
  userId: string,
  id: string,
) {
  const [existing] = await db
    .select()
    .from(miningTasks)
    .where(and(eq(miningTasks.id, id), eq(miningTasks.tenantId, tenantId)))
    .limit(1);
  if (!existing) {
    return jsonError('TASK_NOT_FOUND', 'Task not found', 404);
  }
  // Idempotent — a re-flushed offline ack must not double-complete.
  if (existing.status === 'done') {
    return {
      status: 200 as const,
      body: {
        success: true as const,
        data: existing,
        meta: { idempotent: true as const },
      },
    };
  }
  const completedAt = new Date();
  // Append-only audit invariant: the hash-chained audit row and the status
  // flip MUST commit atomically — wrap both in ONE db.transaction so a failed
  // status update can never leave an orphan audit entry (or vice versa).
  const [row] = await db.transaction(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (tx: any) => {
      const chainId = await appendAuditEntry(tx, {
        action: 'mining.task.complete',
        tenantId,
        turnId: id,
        userId,
        details: {
          taskId: id,
          previousStatus: existing.status,
          completedAt: completedAt.toISOString(),
          via: 'toolbox-acks',
        },
      });
      return tx
        .update(miningTasks)
        .set({
          status: 'done',
          completedAt,
          blockedReason: null,
          hashChainId: chainId,
        })
        .where(and(eq(miningTasks.id, id), eq(miningTasks.tenantId, tenantId)))
        .returning();
    },
  );
  // Close-the-loop cockpit pulse — fire-and-forget, swallowed faults, mirrors
  // the foreground complete handler so the owner inbox learns of the closure.
  if (row) {
    setImmediate(() => {
      try {
        const parentRfbId =
          typeof row.parentRfbId === 'string' ? row.parentRfbId : null;
        const assignee =
          typeof row.assignedToUserId === 'string'
            ? row.assignedToUserId
            : null;
        publishCockpitEvent({
          kind: 'mwikila.acted',
          tenantId,
          emittedAt: new Date().toISOString(),
          actionId: row.id,
          actionKind: 'mining.task.complete',
          category: parentRfbId ? 'rfb-fulfilment' : 'task-completion',
          delegationTier: 'T0',
          summary: JSON.stringify({
            taskId: row.id,
            parentRfbId,
            assignee,
            status: 'done',
            title: row.titleSw ?? row.titleEn ?? '',
          }),
        });
      } catch {
        // bus failures must never leak to the request response.
      }
    });
  }
  return { status: 200 as const, body: { success: true as const, data: row } };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function ackTalk(
  db: any,
  tenantId: string,
  userId: string,
  id: string,
) {
  // Read + conditional update wrapped in ONE db.transaction so the
  // acknowledged-by set is read and written atomically (two concurrent acks
  // can never lost-update each other into a half-built array).
  const outcome = await db.transaction(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (tx: any) => {
      const [existing] = await tx
        .select()
        .from(miningToolboxTalks)
        .where(
          and(
            eq(miningToolboxTalks.id, id),
            eq(miningToolboxTalks.tenantId, tenantId),
          ),
        )
        .limit(1);
      if (!existing) {
        return { kind: 'not_found' as const };
      }
      const current: ReadonlyArray<string> = Array.isArray(
        existing.acknowledgedByUserIds,
      )
        ? (existing.acknowledgedByUserIds as ReadonlyArray<string>)
        : [];
      if (current.includes(userId)) {
        return { kind: 'idempotent' as const, row: existing };
      }
      // Immutability — build a NEW deduped array; never mutate the stored one.
      const next = Array.from(new Set([...current, userId]));
      const [row] = await tx
        .update(miningToolboxTalks)
        .set({ acknowledgedByUserIds: next })
        .where(
          and(
            eq(miningToolboxTalks.id, id),
            eq(miningToolboxTalks.tenantId, tenantId),
          ),
        )
        .returning();
      return { kind: 'acked' as const, row };
    },
  );

  if (outcome.kind === 'not_found') {
    return jsonError('TALK_NOT_FOUND', 'Toolbox talk not found', 404);
  }
  if (outcome.kind === 'idempotent') {
    return {
      status: 200 as const,
      body: {
        success: true as const,
        data: outcome.row,
        meta: { idempotent: true as const },
      },
    };
  }
  return {
    status: 200 as const,
    body: { success: true as const, data: outcome.row },
  };
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export function createMiningToolboxAcksRouter(): Hono {
  const app = new Hono();
  app.use('*', authMiddleware);
  app.use('*', databaseMiddleware);

  app.post('/', zValidator('json', AckBodySchema), async (c: any) => {
    const { tenantId, userId } = c.get('auth') ?? {};
    if (!tenantId || !userId) {
      const err = jsonError('UNAUTHORIZED', 'Authentication required', 401);
      return c.json(err.body, err.status);
    }
    const db = c.get('db');
    if (!db) {
      const err = jsonError(
        'TOOLBOX_ACKS_UNAVAILABLE',
        'database is not configured on this gateway',
        503,
      );
      return c.json(err.body, err.status);
    }

    const body = c.req.valid('json');
    const targetId =
      body.kind === 'task_complete'
        ? (body.taskId ?? body.targetId)
        : (body.talkId ?? body.targetId);
    if (!targetId || !UUID_RE.test(targetId)) {
      const err = jsonError(
        'INVALID_TARGET_ID',
        'target id must be a UUID',
        400,
      );
      return c.json(err.body, err.status);
    }

    try {
      const result =
        body.kind === 'task_complete'
          ? await completeTask(db, tenantId, userId, targetId)
          : await ackTalk(db, tenantId, userId, targetId);
      return c.json(result.body, result.status);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'ack failed';
      moduleLogger.error('toolbox ack dispatch failed', {
        evt: 'toolbox_ack_failed',
        tenantId,
        kind: body.kind,
        targetId,
        reason: message,
      });
      // No raw error.message leak in the client-facing 500 body.
      const e = jsonError(
        'TOOLBOX_ACK_FAILED',
        'Failed to record acknowledgement',
        500,
      );
      return c.json(e.body, e.status);
    }
  });

  return app;
}

export const miningToolboxAcksRouter = createMiningToolboxAcksRouter();
