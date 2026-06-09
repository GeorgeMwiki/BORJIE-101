/**
 * /api/v1/owner/mwikila-inbox — Mr. Mwikila autonomous-MD "Acting on
 * your behalf" inbox.
 *
 * Routes (all tenant-scoped via JWT + RLS):
 *   GET    /                         list pending + recent inbox rows
 *   POST   /:id/approve              T0/T1 owner one-tap approves
 *   POST   /:id/deny                 T0/T1 owner one-tap denies
 *   POST   /:id/reverse              T2 owner reverses within window
 *
 * The recorder lives in `services/mwikila-autonomy/inbox-recorder.ts`
 * — this file is only the HTTP shape. The autonomous handlers post to
 * the recorder directly via the runtime; the inbox surface is owner-
 * facing only.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';

import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { createMwikilaInboxRecorder } from '../../services/mwikila-autonomy';
import {
  ACTION_STATUSES,
  DELEGATION_CATEGORIES,
} from '../../services/mwikila-autonomy';
import { MwikilaError } from '../../services/mwikila-autonomy/types.js';
import { publishCockpitEvent } from '../../services/cockpit-events';
import {
  dispatchAction,
  isKnownVerb,
  type ExecContext,
} from '../../services/action-executor/index.js';
import {
  decideAutoAuthorization,
} from '../../services/auto-authorize-gate/index.js';
import { type ScopeContext } from '@borjie/central-intelligence';
import { createLogger } from '../../utils/logger';

const moduleLogger = createLogger('owner-mwikila-inbox');

const ListQuerySchema = z.object({
  status: z.enum(ACTION_STATUSES).optional(),
  category: z.enum(DELEGATION_CATEGORIES).optional(),
  limit: z
    .union([
      z.number().int().min(1).max(200),
      z
        .string()
        .regex(/^\d+$/)
        .transform((s) => Number(s)),
    ])
    .optional(),
});

const ReverseBodySchema = z
  .object({
    reversalToken: z.string().uuid(),
  })
  .strict();

function dbUnavailable(c: any) {
  return c.json(
    {
      success: false,
      error: {
        code: 'DATABASE_UNAVAILABLE',
        message: 'Database client is not initialized',
      },
    },
    503,
  );
}

function mapMwikilaError(c: any, err: unknown) {
  if (err instanceof MwikilaError) {
    const code = err.code;
    const status: number =
      code === 'not_found'
        ? 404
        : code === 'wrong_status' ||
            code === 'reversal_window_expired' ||
            code === 'reversal_token_mismatch'
          ? 409
          : code === 'invalid_input'
            ? 400
            : 500;
    return c.json(
      {
        success: false,
        error: {
          code: `MWIKILA_${code.toUpperCase()}`,
          message: err.message,
        },
      },
      status,
    );
  }
  return c.json(
    {
      success: false,
      error: {
        code: 'MWIKILA_INTERNAL',
        message: err instanceof Error ? err.message : String(err),
      },
    },
    500,
  );
}

// ─── Post-approval execution (owner-ceo-6 / owner-mwikila-inbox-1) ────
//
// Approving a T0/T1 proposal must CLOSE THE LOOP — not just stamp
// `owner_approved`. After the recorder marks the row approved we:
//   1. Emit a `mwikila.acted` cockpit event so the live cockpit reflects
//      the approval and any subscribed executor/worker is signalled
//      (parity with recordAction, which emits on T2/T3 immediate-exec).
//   2. GENERATIVELY execute when the proposal payload carries an
//      `executeVerb` that the action-executor registry KNOWS and the
//      fail-closed gate authorizes — routed through the SAME
//      gate→dispatch pipeline as the chat confirm path (no per-verb
//      hardcode). On a real execution we transition the row
//      owner_approved→executed and mint a reversal_token for T2.
//   3. For proposals whose terminal effect is a money/filing post (e.g.
//      payroll-prep, royalty-filing) there is no registry verb and the
//      effect MUST route through LedgerService / the recorder's (not-yet-
//      built) execute() worker — we leave the row `owner_approved`,
//      report `executionPending:true`, and the downstream executor that
//      consumes `mwikila.acted` / scans owner_approved rows carries it
//      out. We NEVER falsely flip such a row to `executed`.

interface ApprovalExecutionOutcome {
  readonly executed: boolean;
  readonly executionPending: boolean;
  readonly reason: string;
  readonly reversalToken: string | null;
}

function buildInboxScope(tenantId: string, userId: string): ScopeContext {
  return {
    kind: 'tenant',
    tenantId,
    actorUserId: userId,
    roles: ['OWNER'],
    personaId: 'mr-mwikila-head',
  };
}

/**
 * Transition an approved row to `executed`, stamping execution time and a
 * reversal token for T2 so the owner keeps the reverse-within-window
 * affordance. Tenant-scoped UPDATE under the RLS GUC.
 */
async function markInboxExecuted(
  db: { execute(q: unknown): Promise<unknown> },
  tenantId: string,
  id: string,
  tier: string,
): Promise<string | null> {
  const reversalToken = tier === 'T2' ? randomUUID() : null;
  const reversalUntil =
    reversalToken !== null
      ? new Date(Date.now() + 24 * 3600 * 1000).toISOString()
      : null;
  await db.execute(sql`
    UPDATE mwikila_actions_inbox
       SET status = 'executed',
           executed_at = now(),
           reversal_token = ${reversalToken},
           reversal_until = ${reversalUntil ? sql`${reversalUntil}::timestamptz` : null},
           updated_at = now()
     WHERE tenant_id = ${tenantId} AND id = ${id}
  `);
  return reversalToken;
}

async function executeApprovedAction(args: {
  readonly db: { execute(q: unknown): Promise<unknown> };
  readonly tenantId: string;
  readonly userId: string;
  readonly row: {
    readonly id: string;
    readonly actionKind: string;
    readonly category: string;
    readonly delegationTier: string;
    readonly summary: string;
    readonly payload: Record<string, unknown>;
  };
}): Promise<ApprovalExecutionOutcome> {
  const { db, tenantId, userId, row } = args;

  // 1) Always emit the approval/acted event (enqueue + cockpit parity).
  publishCockpitEvent({
    kind: 'mwikila.acted',
    tenantId,
    emittedAt: new Date().toISOString(),
    actionId: row.id,
    actionKind: row.actionKind,
    category: row.category,
    delegationTier: row.delegationTier as 'T0' | 'T1' | 'T2' | 'T3',
    summary: row.summary,
  });

  // 2) Generative inline execution for a registry-known verb the brain
  //    baked into the payload. Unknown / absent verb → defer (pending).
  const executeVerb =
    typeof row.payload.executeVerb === 'string'
      ? (row.payload.executeVerb as string)
      : null;
  const executeParams =
    row.payload.executeParams && typeof row.payload.executeParams === 'object'
      ? (row.payload.executeParams as Record<string, unknown>)
      : {};

  if (!executeVerb || !isKnownVerb(executeVerb)) {
    moduleLogger.info('mwikila approve: no registry verb — execution pending downstream', {
      tenantId,
      actionId: row.id,
      actionKind: row.actionKind,
      category: row.category,
    });
    return {
      executed: false,
      executionPending: true,
      reason: 'execution_pending_downstream',
      reversalToken: null,
    };
  }

  // Fail-closed authorization on the verb before any dispatch.
  let authorized = false;
  let reason = 'not_authorized';
  try {
    const decision = decideAutoAuthorization(
      executeVerb,
      `mwikila_approve:${row.actionKind}`,
      buildInboxScope(tenantId, userId),
    );
    authorized = decision.authorized;
    reason = decision.reason;
  } catch (err) {
    moduleLogger.error('mwikila approve: gate threw (fail-closed)', {
      tenantId,
      actionId: row.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      executed: false,
      executionPending: true,
      reason: 'gate_error_fail_closed',
      reversalToken: null,
    };
  }
  if (!authorized) {
    return {
      executed: false,
      executionPending: true,
      reason,
      reversalToken: null,
    };
  }

  const ctx: ExecContext = {
    db: db as ExecContext['db'],
    tenantId,
    userId,
    logger: moduleLogger as unknown as ExecContext['logger'],
  };
  const dispatch = await dispatchAction(executeVerb, executeParams, ctx);
  if (!dispatch.executed) {
    return {
      executed: false,
      executionPending: true,
      reason: dispatch.reason,
      reversalToken: null,
    };
  }

  const reversalToken = await markInboxExecuted(
    db,
    tenantId,
    row.id,
    row.delegationTier,
  );
  return {
    executed: true,
    executionPending: false,
    reason: 'executed',
    reversalToken,
  };
}

export const mwikilaInboxRouter = new Hono();
mwikilaInboxRouter.use('*', authMiddleware);
mwikilaInboxRouter.use('*', databaseMiddleware);

mwikilaInboxRouter.get('/', zValidator('query', ListQuerySchema), async (c) => {
  const auth = c.get('auth');
  const db = c.get('db');
  if (!db) return dbUnavailable(c);

  const { status, category, limit } = c.req.valid('query');
  const recorder = createMwikilaInboxRecorder({ db });
  try {
    // exactOptionalPropertyTypes: only set optional fields when the
    // caller actually provided them; never pass `undefined` literally.
    const rows = status
      ? await recorder.listRecent({
          tenantId: auth.tenantId,
          status,
          ...(category !== undefined ? { category } : {}),
          ...(limit !== undefined ? { limit } : {}),
        })
      : await recorder.listPending({
          tenantId: auth.tenantId,
          ...(limit !== undefined ? { limit } : {}),
        });
    return c.json({ success: true, data: rows });
  } catch (err) {
    return mapMwikilaError(c, err);
  }
});

mwikilaInboxRouter.post('/:id/approve', async (c) => {
  const auth = c.get('auth');
  const db = c.get('db');
  if (!db) return dbUnavailable(c);
  const id = c.req.param('id');
  const recorder = createMwikilaInboxRecorder({ db });
  try {
    const row = await recorder.approveProposal({
      tenantId: auth.tenantId,
      id,
      reviewedByUserId: auth.userId,
    });

    // owner-ceo-6 / owner-mwikila-inbox-1: CLOSE THE LOOP. Approval used
    // to end here (status='owner_approved', nothing executed). Now we
    // dispatch the approved action generatively + emit the acted event.
    const outcome = await executeApprovedAction({
      db,
      tenantId: auth.tenantId,
      userId: auth.userId,
      row: {
        id: row.id,
        actionKind: row.actionKind,
        category: row.category,
        delegationTier: row.delegationTier,
        summary: row.summary,
        payload: row.payload as Record<string, unknown>,
      },
    });

    return c.json({
      success: true,
      data: {
        ...row,
        ...(outcome.executed
          ? {
              status: 'executed',
              reversalToken: outcome.reversalToken,
            }
          : {}),
      },
      meta: {
        executed: outcome.executed,
        executionPending: outcome.executionPending,
        executionReason: outcome.reason,
      },
    });
  } catch (err) {
    return mapMwikilaError(c, err);
  }
});

mwikilaInboxRouter.post('/:id/deny', async (c) => {
  const auth = c.get('auth');
  const db = c.get('db');
  if (!db) return dbUnavailable(c);
  const id = c.req.param('id');
  const recorder = createMwikilaInboxRecorder({ db });
  try {
    const row = await recorder.denyProposal({
      tenantId: auth.tenantId,
      id,
      reviewedByUserId: auth.userId,
    });
    return c.json({ success: true, data: row });
  } catch (err) {
    return mapMwikilaError(c, err);
  }
});

mwikilaInboxRouter.post(
  '/:id/reverse',
  zValidator('json', ReverseBodySchema),
  async (c) => {
    const auth = c.get('auth');
    const db = c.get('db');
    if (!db) return dbUnavailable(c);
    const id = c.req.param('id');
    const { reversalToken } = c.req.valid('json');
    const recorder = createMwikilaInboxRecorder({ db });
    try {
      const row = await recorder.reverseExecution({
        tenantId: auth.tenantId,
        id,
        reversalToken,
        reviewedByUserId: auth.userId,
      });
      return c.json({ success: true, data: row });
    } catch (err) {
      return mapMwikilaError(c, err);
    }
  },
);
