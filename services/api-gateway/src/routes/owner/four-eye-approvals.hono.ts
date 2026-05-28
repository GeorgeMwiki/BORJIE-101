/**
 * /api/v1/owner/four-eye — two-person sign-off on high-stakes actions.
 *
 * Wave FOUR-EYE-APPROVAL. The owner cannot unilaterally fire a payment
 * over 5M TZS, file with a regulator, or sign a contract on behalf of
 * the company; every high-stakes action lands here first.
 *
 * Routes:
 *   POST   /request                  Owner initiates an approval request.
 *                                    Returns a tokenised approval URL.
 *   GET    /pending                  Both approvers see queues scoped
 *                                    to themselves.
 *   POST   /approve/:token           Second approver approves — original
 *                                    action is dispatched, hash-audited.
 *   POST   /reject/:token            Second approver rejects with note.
 *
 * Auth: `request`, `pending` use Supabase JWT (`authMiddleware`).
 *       `approve` / `reject` use the same auth — the second approver
 *       must be signed in. The token only proves which request to
 *       resolve; identity always comes from the session.
 *
 * Tenant scope: bound by `databaseMiddleware`'s `app.tenant_id` GUC.
 * RLS forces row visibility per tenant.
 *
 * Hash-chain: every state change (create / decide / execute) writes a
 * row into `ai_audit_chain` linked to the previous head per tenant.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { createHash, randomUUID, randomBytes } from 'node:crypto';
import { and, desc, eq, or, sql } from 'drizzle-orm';

import {
  fourEyeRequests,
  FOUR_EYE_ACTION_TYPES,
  FOUR_EYE_STATUSES,
} from '@borjie/database';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { createLogger } from '../../utils/logger';

const moduleLogger = createLogger('owner-four-eye');

const DEFAULT_TTL_MINUTES = 24 * 60;
const APPROVAL_TOKEN_BYTES = 32;

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const requestSchema = z.object({
  actionType: z.enum(FOUR_EYE_ACTION_TYPES),
  payload: z.record(z.string(), z.unknown()),
  /** Supabase user id of the proposed second approver. May be set later. */
  secondApproverId: z.string().min(1).max(128).optional(),
  /** TTL in minutes — defaults to 24h. */
  ttlMinutes: z.number().int().min(15).max(7 * 24 * 60).optional(),
});

const decisionSchema = z.object({
  note: z.string().trim().max(2000).optional(),
});

const listQuerySchema = z.object({
  status: z.enum(FOUR_EYE_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ok<T>(data: T) {
  return { success: true as const, data };
}

function err(code: string, message: string) {
  return { success: false as const, error: { code, message } };
}

function buildToken(): string {
  // 32 random bytes URL-safe-base64 → 43 chars. The token is the
  // sole proof that links a click back to a request id; never reveal
  // server-side data without verifying the signed-in session matches
  // the second approver.
  return randomBytes(APPROVAL_TOKEN_BYTES)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function appendAuditEntry(
  db: any,
  payload: {
    readonly action: string;
    readonly tenantId: string;
    readonly turnId: string;
    readonly userId: string;
    readonly details: Readonly<Record<string, unknown>>;
  },
): Promise<string | null> {
  const id = randomUUID();
  const canonical = JSON.stringify({
    tenantId: payload.tenantId,
    turnId: payload.turnId,
    action: payload.action,
    userId: payload.userId,
    details: payload.details,
  });
  try {
    const latestResult: unknown = await db.execute(
      sql`SELECT COALESCE(MAX(sequence_id), 0) AS max_seq,
                 (SELECT this_hash FROM ai_audit_chain
                  WHERE tenant_id = ${payload.tenantId}
                  ORDER BY sequence_id DESC LIMIT 1) AS last_hash
          FROM ai_audit_chain
          WHERE tenant_id = ${payload.tenantId}`,
    );
    const rows =
      (latestResult as { rows?: ReadonlyArray<Record<string, unknown>> })
        .rows ?? (latestResult as ReadonlyArray<Record<string, unknown>>);
    const head = rows[0] ?? {};
    const maxSeq = Number((head as Record<string, unknown>).max_seq ?? 0);
    const lastHashRaw = (head as Record<string, unknown>).last_hash;
    const lastHash =
      typeof lastHashRaw === 'string' && lastHashRaw.length > 0
        ? lastHashRaw
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
        ${id},
        ${payload.tenantId},
        ${sequenceId},
        ${payload.turnId},
        ${payload.action},
        ${lastHash},
        ${thisHash},
        ${JSON.stringify({
          userId: payload.userId,
          details: payload.details,
        })}::jsonb,
        ${new Date().toISOString()}
      )
    `);
    return id;
  } catch (auditErr) {
    moduleLogger.warn('four-eye audit append failed', {
      tenantId: payload.tenantId,
      action: payload.action,
      reason:
        auditErr instanceof Error ? auditErr.message : String(auditErr),
    });
    return null;
  }
}

interface DispatchOutcome {
  readonly executed: boolean;
  readonly result: Record<string, unknown>;
}

/**
 * Dispatch the underlying action through the matching brain tool. The
 * actual brain-tool wiring lives in
 * `services/api-gateway/src/services/document-drafter/brain-tools.ts`
 * and the payment / ledger service. To keep this route surface
 * compositional, we return a deterministic envelope here — the brain
 * tool dispatcher is wired separately via a composition hook so tests
 * can inject a fake.
 */
async function dispatchActionForRequest(args: {
  readonly actionType: string;
  readonly payload: Record<string, unknown>;
}): Promise<DispatchOutcome> {
  // Default behaviour: record the dispatch but do not perform the
  // side-effect. The brain-tool dispatcher injects the real handler at
  // bootstrap via `setFourEyeDispatcher`. Keeps the route file free of
  // the LedgerService import (avoid cycles).
  const handler = dispatcherRef.current;
  if (!handler) {
    return {
      executed: false,
      result: {
        actionType: args.actionType,
        message: 'no_dispatcher_registered',
      },
    };
  }
  try {
    const result = await handler(args);
    return { executed: true, result };
  } catch (e) {
    return {
      executed: false,
      result: {
        actionType: args.actionType,
        error: e instanceof Error ? e.message : String(e),
      },
    };
  }
}

const dispatcherRef: {
  current:
    | ((args: {
        readonly actionType: string;
        readonly payload: Record<string, unknown>;
      }) => Promise<Record<string, unknown>>)
    | null;
} = { current: null };

/**
 * Composition hook — wire the real brain-tool dispatcher at bootstrap.
 * Keeps the route file free of LedgerService / brain imports so we
 * avoid a cycle at module-init time.
 */
export function setFourEyeDispatcher(
  handler: (args: {
    readonly actionType: string;
    readonly payload: Record<string, unknown>;
  }) => Promise<Record<string, unknown>>,
): void {
  dispatcherRef.current = handler;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const app = new Hono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

// ---------------------------------------------------------------------------
// POST /request — owner initiates a high-stakes action
// ---------------------------------------------------------------------------

app.post('/request', async (c: any) => {
  const auth = c.get('auth') as { tenantId: string; userId: string };
  const db = c.get('db');
  if (!db) {
    return c.json(err('FOUR_EYE_DB_UNAVAILABLE', 'Database not configured'), 503);
  }
  const raw = await c.req.json().catch(() => null);
  const parsed = requestSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json(err('VALIDATION_ERROR', 'Invalid four-eye request payload'), 400);
  }
  const id = randomUUID();
  const token = buildToken();
  const ttlMinutes = parsed.data.ttlMinutes ?? DEFAULT_TTL_MINUTES;
  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);
  const now = new Date();
  try {
    const [row] = await db
      .insert(fourEyeRequests)
      .values({
        id,
        tenantId: auth.tenantId,
        requesterId: auth.userId,
        secondApproverId: parsed.data.secondApproverId ?? null,
        actionType: parsed.data.actionType,
        payload: parsed.data.payload,
        approvalToken: token,
        status: 'pending',
        expiresAt,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    const auditId = await appendAuditEntry(db, {
      action: 'four_eye.request.create',
      tenantId: auth.tenantId,
      turnId: id,
      userId: auth.userId,
      details: {
        requestId: id,
        actionType: parsed.data.actionType,
        secondApproverId: parsed.data.secondApproverId ?? null,
        ttlMinutes,
      },
    });

    if (auditId) {
      await db
        .update(fourEyeRequests)
        .set({ auditCreateId: auditId, updatedAt: new Date() })
        .where(
          and(
            eq(fourEyeRequests.tenantId, auth.tenantId),
            eq(fourEyeRequests.id, id),
          ),
        );
    }

    moduleLogger.info('four-eye: request created', {
      tenantId: auth.tenantId,
      requesterId: auth.userId,
      requestId: id,
      actionType: parsed.data.actionType,
    });

    return c.json(
      ok({
        id: row.id,
        actionType: row.actionType,
        status: row.status,
        approvalToken: token,
        approvalUrl: `/four-eye/approve/${token}`,
        expiresAt: row.expiresAt,
        auditCreateId: auditId,
      }),
      201,
    );
  } catch (e) {
    moduleLogger.error('four-eye: request creation failed', {
      tenantId: auth.tenantId,
      reason: e instanceof Error ? e.message : String(e),
    });
    return c.json(err('FOUR_EYE_CREATE_FAILED', 'Failed to create request'), 500);
  }
});

// ---------------------------------------------------------------------------
// GET /pending — queue for both requester and second approver
// ---------------------------------------------------------------------------

app.get('/pending', async (c: any) => {
  const auth = c.get('auth') as { tenantId: string; userId: string };
  const db = c.get('db');
  if (!db) {
    return c.json(err('FOUR_EYE_DB_UNAVAILABLE', 'Database not configured'), 503);
  }
  const parsed = listQuerySchema.safeParse({
    status: c.req.query('status'),
    limit: c.req.query('limit'),
  });
  if (!parsed.success) {
    return c.json(err('VALIDATION_ERROR', 'Invalid query'), 400);
  }
  const rows = await db
    .select({
      id: fourEyeRequests.id,
      actionType: fourEyeRequests.actionType,
      status: fourEyeRequests.status,
      requesterId: fourEyeRequests.requesterId,
      secondApproverId: fourEyeRequests.secondApproverId,
      decisionNote: fourEyeRequests.decisionNote,
      expiresAt: fourEyeRequests.expiresAt,
      decidedAt: fourEyeRequests.decidedAt,
      executedAt: fourEyeRequests.executedAt,
      createdAt: fourEyeRequests.createdAt,
    })
    .from(fourEyeRequests)
    .where(
      and(
        eq(fourEyeRequests.tenantId, auth.tenantId),
        or(
          eq(fourEyeRequests.requesterId, auth.userId),
          eq(fourEyeRequests.secondApproverId, auth.userId),
        ),
        parsed.data.status
          ? eq(fourEyeRequests.status, parsed.data.status)
          : sql`status IN ('pending', 'approved')`,
      ),
    )
    .orderBy(desc(fourEyeRequests.createdAt))
    .limit(parsed.data.limit);
  return c.json(ok({ requests: rows }), 200);
});

// ---------------------------------------------------------------------------
// Shared internals for /approve and /reject
// ---------------------------------------------------------------------------

async function loadByToken(
  db: any,
  tenantId: string,
  token: string,
): Promise<typeof fourEyeRequests.$inferSelect | null> {
  const [row] = await db
    .select()
    .from(fourEyeRequests)
    .where(
      and(
        eq(fourEyeRequests.tenantId, tenantId),
        eq(fourEyeRequests.approvalToken, token),
      ),
    )
    .limit(1);
  return row ?? null;
}

function isExpired(row: { expiresAt: Date | string | null }, now: Date): boolean {
  if (!row.expiresAt) return false;
  const ts =
    row.expiresAt instanceof Date
      ? row.expiresAt.getTime()
      : new Date(row.expiresAt).getTime();
  return Number.isFinite(ts) && ts <= now.getTime();
}

// ---------------------------------------------------------------------------
// POST /approve/:token — second approver approves, executes brain tool
// ---------------------------------------------------------------------------

app.post('/approve/:token', async (c: any) => {
  const auth = c.get('auth') as { tenantId: string; userId: string };
  const db = c.get('db');
  if (!db) {
    return c.json(err('FOUR_EYE_DB_UNAVAILABLE', 'Database not configured'), 503);
  }
  const token = c.req.param('token');
  if (typeof token !== 'string' || token.length < 16) {
    return c.json(err('INVALID_TOKEN', 'Token is invalid'), 400);
  }
  const raw = await c.req.json().catch(() => ({}));
  const parsedNote = decisionSchema.safeParse(raw ?? {});
  if (!parsedNote.success) {
    return c.json(err('VALIDATION_ERROR', 'Invalid decision body'), 400);
  }
  const row = await loadByToken(db, auth.tenantId, token);
  if (!row) {
    return c.json(err('NOT_FOUND', 'Approval request not found'), 404);
  }
  if (row.requesterId === auth.userId) {
    return c.json(
      err('SELF_APPROVAL_FORBIDDEN', 'Requester cannot approve their own action'),
      403,
    );
  }
  const now = new Date();
  if (isExpired(row, now)) {
    await db
      .update(fourEyeRequests)
      .set({ status: 'expired', updatedAt: now })
      .where(
        and(
          eq(fourEyeRequests.tenantId, auth.tenantId),
          eq(fourEyeRequests.id, row.id),
        ),
      );
    return c.json(err('REQUEST_EXPIRED', 'Approval window has closed'), 410);
  }
  if (row.status !== 'pending') {
    return c.json(
      err('NOT_PENDING', `Request is already ${row.status}`),
      409,
    );
  }
  const decideAuditId = await appendAuditEntry(db, {
    action: 'four_eye.request.approve',
    tenantId: auth.tenantId,
    turnId: row.id,
    userId: auth.userId,
    details: {
      requestId: row.id,
      actionType: row.actionType,
      note: parsedNote.data.note ?? null,
    },
  });

  await db
    .update(fourEyeRequests)
    .set({
      status: 'approved',
      decisionNote: parsedNote.data.note ?? null,
      secondApproverId: row.secondApproverId ?? auth.userId,
      decidedAt: now,
      auditDecideId: decideAuditId,
      updatedAt: now,
    })
    .where(
      and(
        eq(fourEyeRequests.tenantId, auth.tenantId),
        eq(fourEyeRequests.id, row.id),
      ),
    );

  // Execute the original action through the registered brain-tool
  // dispatcher. Failures are captured into the row but do NOT roll
  // back the approval state — the audit chain shows both events.
  const dispatchResult = await dispatchActionForRequest({
    actionType: row.actionType,
    payload: (row.payload as Record<string, unknown>) ?? {},
  });

  const executeAuditId = await appendAuditEntry(db, {
    action: 'four_eye.request.execute',
    tenantId: auth.tenantId,
    turnId: row.id,
    userId: auth.userId,
    details: {
      requestId: row.id,
      actionType: row.actionType,
      executed: dispatchResult.executed,
      result: dispatchResult.result,
    },
  });

  const executedAt = dispatchResult.executed ? now : null;
  await db
    .update(fourEyeRequests)
    .set({
      status: dispatchResult.executed ? 'executed' : 'approved',
      executedAt,
      executionResult: dispatchResult.result,
      auditExecuteId: executeAuditId,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(fourEyeRequests.tenantId, auth.tenantId),
        eq(fourEyeRequests.id, row.id),
      ),
    );

  moduleLogger.info('four-eye: request approved', {
    tenantId: auth.tenantId,
    approverId: auth.userId,
    requestId: row.id,
    executed: dispatchResult.executed,
  });

  return c.json(
    ok({
      id: row.id,
      status: dispatchResult.executed ? 'executed' : 'approved',
      decidedAt: now,
      executedAt,
      executionResult: dispatchResult.result,
      auditDecideId: decideAuditId,
      auditExecuteId: executeAuditId,
    }),
    200,
  );
});

// ---------------------------------------------------------------------------
// POST /reject/:token — second approver rejects with note
// ---------------------------------------------------------------------------

app.post('/reject/:token', async (c: any) => {
  const auth = c.get('auth') as { tenantId: string; userId: string };
  const db = c.get('db');
  if (!db) {
    return c.json(err('FOUR_EYE_DB_UNAVAILABLE', 'Database not configured'), 503);
  }
  const token = c.req.param('token');
  if (typeof token !== 'string' || token.length < 16) {
    return c.json(err('INVALID_TOKEN', 'Token is invalid'), 400);
  }
  const raw = await c.req.json().catch(() => ({}));
  const parsedNote = decisionSchema.safeParse(raw ?? {});
  if (!parsedNote.success) {
    return c.json(err('VALIDATION_ERROR', 'Invalid decision body'), 400);
  }
  const row = await loadByToken(db, auth.tenantId, token);
  if (!row) {
    return c.json(err('NOT_FOUND', 'Approval request not found'), 404);
  }
  if (row.requesterId === auth.userId) {
    return c.json(
      err('SELF_REJECTION_FORBIDDEN', 'Requester cannot reject their own action'),
      403,
    );
  }
  const now = new Date();
  if (isExpired(row, now)) {
    await db
      .update(fourEyeRequests)
      .set({ status: 'expired', updatedAt: now })
      .where(
        and(
          eq(fourEyeRequests.tenantId, auth.tenantId),
          eq(fourEyeRequests.id, row.id),
        ),
      );
    return c.json(err('REQUEST_EXPIRED', 'Approval window has closed'), 410);
  }
  if (row.status !== 'pending') {
    return c.json(
      err('NOT_PENDING', `Request is already ${row.status}`),
      409,
    );
  }
  const decideAuditId = await appendAuditEntry(db, {
    action: 'four_eye.request.reject',
    tenantId: auth.tenantId,
    turnId: row.id,
    userId: auth.userId,
    details: {
      requestId: row.id,
      actionType: row.actionType,
      note: parsedNote.data.note ?? null,
    },
  });
  await db
    .update(fourEyeRequests)
    .set({
      status: 'rejected',
      decisionNote: parsedNote.data.note ?? null,
      secondApproverId: row.secondApproverId ?? auth.userId,
      decidedAt: now,
      auditDecideId: decideAuditId,
      updatedAt: now,
    })
    .where(
      and(
        eq(fourEyeRequests.tenantId, auth.tenantId),
        eq(fourEyeRequests.id, row.id),
      ),
    );
  moduleLogger.info('four-eye: request rejected', {
    tenantId: auth.tenantId,
    approverId: auth.userId,
    requestId: row.id,
  });
  return c.json(
    ok({
      id: row.id,
      status: 'rejected',
      decidedAt: now,
      auditDecideId: decideAuditId,
    }),
    200,
  );
});

export const fourEyeApprovalsRouter = app;
export default fourEyeApprovalsRouter;
