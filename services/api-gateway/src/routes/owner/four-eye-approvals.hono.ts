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
import { authMiddleware, requireRole } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { UserRole } from '../../types/user-role';
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

// ---------------------------------------------------------------------------
// Shared enqueue path — the ONE place a four-eye request is created.
// ---------------------------------------------------------------------------

/**
 * Arguments for {@link enqueueFourEyeRequest}. `actionType` is stored in
 * the free-form `action_type` text column; callers outside the owner
 * `/request` surface (e.g. the chat-actions dual-control bridge) pass a
 * brain verb here that is NOT one of `FOUR_EYE_ACTION_TYPES`, which is
 * fine — the column is unconstrained text and the original verb is also
 * preserved inside `payload`.
 */
export interface EnqueueFourEyeArgs {
  readonly tenantId: string;
  readonly requesterId: string;
  readonly actionType: string;
  readonly payload: Record<string, unknown>;
  /** Supabase user id of the proposed second approver. May be set later. */
  readonly secondApproverId?: string;
  /** TTL in minutes — defaults to {@link DEFAULT_TTL_MINUTES} (24h). */
  readonly ttlMinutes?: number;
}

/**
 * Insert a pending four-eye request + append the `four_eye.request.create`
 * audit entry. This is the SINGLE enqueue path: the owner `POST /request`
 * handler and any cross-route caller (the chat-actions dual-control
 * bridge) both funnel through here so the insert + audit logic is never
 * duplicated.
 *
 * Honest-degrade: returns `null` (never throws) on any DB / insert
 * failure so a caller in a stream / handler can fall back gracefully. The
 * audit append is itself soft-failing (logs + returns null) and never
 * voids the created request.
 */
export async function enqueueFourEyeRequest(
  db: any,
  args: EnqueueFourEyeArgs,
): Promise<{ readonly requestId: string; readonly approvalToken: string } | null> {
  if (!db) {
    return null;
  }
  const id = randomUUID();
  const token = buildToken();
  const ttlMinutes = args.ttlMinutes ?? DEFAULT_TTL_MINUTES;
  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);
  const now = new Date();
  try {
    await db
      .insert(fourEyeRequests)
      .values({
        id,
        tenantId: args.tenantId,
        requesterId: args.requesterId,
        secondApproverId: args.secondApproverId ?? null,
        actionType: args.actionType,
        payload: args.payload,
        approvalToken: token,
        status: 'pending',
        expiresAt,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    const auditId = await appendAuditEntry(db, {
      action: 'four_eye.request.create',
      tenantId: args.tenantId,
      turnId: id,
      userId: args.requesterId,
      details: {
        requestId: id,
        actionType: args.actionType,
        secondApproverId: args.secondApproverId ?? null,
        ttlMinutes,
      },
    });

    if (auditId) {
      await db
        .update(fourEyeRequests)
        .set({ auditCreateId: auditId, updatedAt: new Date() })
        .where(
          and(
            eq(fourEyeRequests.tenantId, args.tenantId),
            eq(fourEyeRequests.id, id),
          ),
        );
    }

    moduleLogger.info('four-eye: request enqueued', {
      tenantId: args.tenantId,
      requesterId: args.requesterId,
      requestId: id,
      actionType: args.actionType,
    });

    return { requestId: id, approvalToken: token };
  } catch (e) {
    moduleLogger.error('four-eye: enqueue failed', {
      tenantId: args.tenantId,
      actionType: args.actionType,
      reason: e instanceof Error ? e.message : String(e),
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
  /**
   * Stable idempotency key (`four-eye:<requestId>`) threaded into the real
   * brain-tool / LedgerService dispatcher so a money mutation dedupes on
   * retry — the CAS already guarantees a single approval winner, this guards
   * the side-effect leg if the same winner is replayed.
   */
  readonly idempotencyKey: string;
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
        readonly idempotencyKey: string;
      }) => Promise<Record<string, unknown>>)
    | null;
} = { current: null };

/**
 * Composition hook — wire the real brain-tool dispatcher at bootstrap.
 * Keeps the route file free of LedgerService / brain imports so we
 * avoid a cycle at module-init time. The handler receives a stable
 * `idempotencyKey` (`four-eye:<requestId>`) so the money path can route
 * it into `LedgerService.post`'s idempotency guard.
 */
export function setFourEyeDispatcher(
  handler: (args: {
    readonly actionType: string;
    readonly payload: Record<string, unknown>;
    readonly idempotencyKey: string;
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
  const enqueued = await enqueueFourEyeRequest(db, {
    tenantId: auth.tenantId,
    requesterId: auth.userId,
    actionType: parsed.data.actionType,
    payload: parsed.data.payload,
    ...(parsed.data.secondApproverId !== undefined
      ? { secondApproverId: parsed.data.secondApproverId }
      : {}),
    ...(parsed.data.ttlMinutes !== undefined
      ? { ttlMinutes: parsed.data.ttlMinutes }
      : {}),
  });
  if (!enqueued) {
    return c.json(err('FOUR_EYE_CREATE_FAILED', 'Failed to create request'), 500);
  }

  const [row] = await db
    .select({
      id: fourEyeRequests.id,
      actionType: fourEyeRequests.actionType,
      status: fourEyeRequests.status,
      expiresAt: fourEyeRequests.expiresAt,
      auditCreateId: fourEyeRequests.auditCreateId,
    })
    .from(fourEyeRequests)
    .where(
      and(
        eq(fourEyeRequests.tenantId, auth.tenantId),
        eq(fourEyeRequests.id, enqueued.requestId),
      ),
    )
    .limit(1);

  return c.json(
    ok({
      id: enqueued.requestId,
      actionType: row?.actionType ?? parsed.data.actionType,
      status: row?.status ?? 'pending',
      approvalToken: enqueued.approvalToken,
      approvalUrl: `/four-eye/approve/${enqueued.approvalToken}`,
      expiresAt: row?.expiresAt ?? null,
      auditCreateId: row?.auditCreateId ?? null,
    }),
    201,
  );
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

/**
 * Owner / tenant-admin-class principals authorised to resolve a four-eye
 * request. The token proves WHICH request; this gate + {@link assertSecondApprover}
 * prove WHO may resolve it. Workforce field roles (MAINTENANCE_STAFF) and
 * external read-only roles (RESIDENT/buyer) can never sign off a high-stakes
 * action even if they somehow hold a token.
 */
const FOUR_EYE_APPROVER_ROLES = [
  UserRole.OWNER,
  UserRole.TENANT_ADMIN,
  UserRole.PROPERTY_MANAGER,
] as const;

/**
 * Dual-control identity check. Returns an error envelope (caller maps it to
 * 403) when the caller is NOT permitted to resolve this request, or `null`
 * when they are:
 *   - A designated second approver was set → the caller MUST be exactly that
 *     principal. The token is not authorization; whoever holds it is rejected
 *     unless they are the named designee.
 *   - No designee was set → fall back to forbidding self-approval so the
 *     requester can never sign off their own action.
 */
function assertSecondApprover(
  row: { requesterId: string; secondApproverId: string | null },
  callerUserId: string,
): { code: string; message: string } | null {
  if (row.secondApproverId !== null && row.secondApproverId !== undefined) {
    if (callerUserId !== row.secondApproverId) {
      return {
        code: 'NOT_DESIGNATED_APPROVER',
        message: 'Only the designated second approver may resolve this request',
      };
    }
    return null;
  }
  if (row.requesterId === callerUserId) {
    return {
      code: 'SELF_APPROVAL_FORBIDDEN',
      message: 'Requester cannot resolve their own action',
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// POST /approve/:token — second approver approves, executes brain tool
// ---------------------------------------------------------------------------

app.post('/approve/:token', requireRole(...FOUR_EYE_APPROVER_ROLES), async (c: any) => {
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
  // Dual-control identity gate. When a second approver was designated at
  // request time, ONLY that principal may resolve it — the token alone is
  // not authorization. When no designee was set, fall back to the
  // self-approval block so the requester can never approve their own action.
  const designeeCheck = assertSecondApprover(row, auth.userId);
  if (designeeCheck) {
    return c.json(err(designeeCheck.code, designeeCheck.message), 403);
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
  // Compare-and-set: flip pending→approved ONLY if the row is still pending,
  // and act exclusively on the returned row. Two concurrent approves race
  // here; the loser's UPDATE matches zero rows → 409 NOT_PENDING and it never
  // dispatches, never appends an audit entry. Only the CAS winner proceeds.
  const claimed = await db
    .update(fourEyeRequests)
    .set({
      status: 'approved',
      decisionNote: parsedNote.data.note ?? null,
      secondApproverId: row.secondApproverId ?? auth.userId,
      decidedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(fourEyeRequests.tenantId, auth.tenantId),
        eq(fourEyeRequests.id, row.id),
        eq(fourEyeRequests.status, 'pending'),
      ),
    )
    .returning({ id: fourEyeRequests.id });

  if (!Array.isArray(claimed) || claimed.length === 0) {
    // Lost the race (or status moved under us) — do NOT dispatch.
    return c.json(
      err('NOT_PENDING', 'Request is already approved'),
      409,
    );
  }

  // CAS won — append the decision audit entry and persist its id. Only the
  // winner reaches here, so the hash-chain records exactly one approval.
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
  if (decideAuditId) {
    await db
      .update(fourEyeRequests)
      .set({ auditDecideId: decideAuditId, updatedAt: new Date() })
      .where(
        and(
          eq(fourEyeRequests.tenantId, auth.tenantId),
          eq(fourEyeRequests.id, row.id),
        ),
      );
  }

  // Execute the original action through the registered brain-tool
  // dispatcher. Failures are captured into the row but do NOT roll
  // back the approval state — the audit chain shows both events.
  const dispatchResult = await dispatchActionForRequest({
    actionType: row.actionType,
    payload: (row.payload as Record<string, unknown>) ?? {},
    idempotencyKey: `four-eye:${row.id}`,
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

app.post('/reject/:token', requireRole(...FOUR_EYE_APPROVER_ROLES), async (c: any) => {
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
  // Same dual-control identity gate as /approve — a designated second
  // approver is the ONLY principal who may reject; otherwise fall back to
  // forbidding self-rejection.
  const designeeCheck = assertSecondApprover(row, auth.userId);
  if (designeeCheck) {
    return c.json(err(designeeCheck.code, designeeCheck.message), 403);
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
  // Compare-and-set: only the caller that flips pending→rejected wins; a
  // concurrent reject (or an approve that already moved the row) matches zero
  // rows → 409. The loser appends no audit entry.
  const claimed = await db
    .update(fourEyeRequests)
    .set({
      status: 'rejected',
      decisionNote: parsedNote.data.note ?? null,
      secondApproverId: row.secondApproverId ?? auth.userId,
      decidedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(fourEyeRequests.tenantId, auth.tenantId),
        eq(fourEyeRequests.id, row.id),
        eq(fourEyeRequests.status, 'pending'),
      ),
    )
    .returning({ id: fourEyeRequests.id });
  if (!Array.isArray(claimed) || claimed.length === 0) {
    return c.json(
      err('NOT_PENDING', 'Request is already resolved'),
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
  if (decideAuditId) {
    await db
      .update(fourEyeRequests)
      .set({ auditDecideId: decideAuditId, updatedAt: new Date() })
      .where(
        and(
          eq(fourEyeRequests.tenantId, auth.tenantId),
          eq(fourEyeRequests.id, row.id),
        ),
      );
  }
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
