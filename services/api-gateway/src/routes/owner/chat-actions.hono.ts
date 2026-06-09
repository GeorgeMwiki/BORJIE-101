/**
 * /api/v1/owner/chat/* — the chat→action EXECUTION endpoints.
 *
 * Mr. Mwikila's cockpit chat emits action chips (`micro_action_card`,
 * `confirmation_card`). The FE dispatches the user's tap here. Until this
 * route landed those endpoints did not exist and the chips were inert.
 *
 * Two endpoints, ONE gate→execute→audit path:
 *
 *   POST /micro-action   { verb, params }                  — a chip the
 *       chat surfaced (e.g. an `auto_authorized` follow-up the user taps).
 *       AUTO-SAFE surface: it REFUSES confirm-required verbs (create_site
 *       / add_employee / create_licence / log_production / draft_payroll_run)
 *       with `reason:'confirmation_required'`.
 *   POST /confirm-action { verb, params } | { actionId }   — an action
 *       the user EXPLICITLY confirmed via a `confirmation_card`. This is
 *       the ONLY path that runs confirm-required domain verbs (sites +
 *       employees + licences + production records → real persisted rows,
 *       plus draft_payroll_run → a non-binding `payroll_runs` DRAFT header
 *       the owner approves elsewhere; it NEVER moves money / posts a ledger).
 *
 * Both run, in order:
 *   1. authMiddleware  — Supabase JWT (canonical auth).
 *   2. databaseMiddleware — binds `app.current_tenant_id` GUC for RLS.
 *   3. zod-validate the body.
 *   4. decideAutoAuthorization(verb, rationale, scope) — the FAIL-CLOSED
 *      policy-gate + inviolable + HIGH-risk-literal gate. If NOT
 *      authorized → return 200 `{ executed:false, authorized:false,
 *      reason }` and NEVER execute.
 *   5. dispatchAction(verb, params, ctx) — run the SAFE handler. Unknown
 *      verb → `{ executed:false, reason:'unknown_action' }` (no throw).
 *   6. On a real execution, append a hash-chained `decision:'executed'`
 *      audit row (append-only) BEFORE returning.
 *
 * HARD RULES (CLAUDE.md): money never MOVED here. No verb posts a ledger or
 * commits wages — the one money-ADJACENT verb (draft_payroll_run) creates
 * ONLY a non-binding `payroll_runs` DRAFT header (status='draft', no wage
 * figures, no LedgerService) that the owner approves on a separate four-eye
 * flow. RLS never disabled / double-filtered; audit chain append-only; gate
 * FAILS CLOSED (on any gate error it returns authorized:false → no execute).
 */

import { Hono } from 'hono';
import { z } from 'zod';

import { type ScopeContext } from '@borjie/central-intelligence';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { createLogger } from '../../utils/logger';
import {
  decideAutoAuthorization,
  screenGenerativeVerb,
} from '../../services/auto-authorize-gate/index.js';
import { appendAutoAuthorizedAudit } from '../../services/auto-authorize-gate/audit.js';
import {
  dispatchAction,
  requiresConfirmation,
  isKnownVerb,
  type ExecContext,
  type ExecResult,
} from '../../services/action-executor/index.js';

const moduleLogger = createLogger('owner-chat-actions');

// ─── Schemas ─────────────────────────────────────────────────────────

const VerbSchema = z
  .string()
  .min(1)
  .max(120)
  // Action verbs are snake/kebab tokens, optionally namespaced
  // (`set_reminder`, `sovereign:transfer`). Reject anything with
  // whitespace / control chars so a junk verb can't smuggle prose into
  // the gate's rationale matching.
  .regex(/^[a-z0-9][a-z0-9._:-]*$/i, 'verb must be a bare action token');

const microActionSchema = z.object({
  verb: VerbSchema,
  params: z.record(z.string(), z.unknown()).default({}),
  /** Optional model rationale — fed to the policy gate. */
  rationale: z.string().max(2000).optional(),
});

/**
 * confirm-action accepts EITHER an inline {verb, params} (the common
 * case — the confirmation card carries the action) OR a bare actionId
 * referencing a previously-proposed action. Exactly one shape is
 * required. actionId-only resolution is not yet wired (no proposed-action
 * store exists in the gateway), so it returns a graceful not-executable
 * envelope rather than throwing.
 */
const confirmActionSchema = z
  .object({
    verb: VerbSchema.optional(),
    params: z.record(z.string(), z.unknown()).default({}),
    actionId: z.string().min(1).max(200).optional(),
    rationale: z.string().max(2000).optional(),
  })
  .refine((d) => Boolean(d.verb) || Boolean(d.actionId), {
    message: 'provide a verb or an actionId',
    path: ['verb'],
  });

// ─── Shared gate→execute→audit core ──────────────────────────────────

interface AuthCtx {
  readonly tenantId: string;
  readonly userId: string;
  readonly role?: string;
}

/**
 * Build the verified scope for the gate from the request auth context.
 * Always a tenant scope (these are owner-cockpit endpoints). The role is
 * forwarded so role-sensitive policy rules can fire.
 */
function buildScope(auth: AuthCtx): ScopeContext {
  return {
    kind: 'tenant',
    tenantId: auth.tenantId,
    actorUserId: auth.userId,
    roles: auth.role ? [auth.role] : [],
    personaId: 'mr-mwikila-head',
  };
}

/**
 * The 200-body shape both endpoints return. An unauthorized or unknown
 * action is a successful *decision*, not an HTTP error — so it is still
 * `success:true` with `executed:false`.
 */
type ActionResponseBody =
  | { readonly success: true; readonly data: { readonly executed: true; readonly result: ExecResult } }
  | {
      readonly success: true;
      readonly data: {
        readonly executed: false;
        readonly authorized: boolean;
        readonly reason: string;
        /**
         * GENERATIVE FULFILLMENT (self-evolving org). `true` when the verb is
         * NOT in the deterministic registry but cleared the HARD rails — the
         * caller routes it to the brain's agentic turn to fulfill (the brain
         * that emitted the dynamic action also fulfills it). The verb/params
         * are echoed so the caller can build a structured fulfillment turn.
         */
        readonly deferToBrain?: boolean;
        readonly verb?: string;
        readonly params?: Record<string, unknown>;
      };
    };

/**
 * The single authorization → execution → audit pipeline both endpoints
 * share. Returns a 200 in every non-auth/non-infra case — an unauthorized
 * or unknown action is a successful *decision*, not an HTTP error.
 */
async function gateExecuteAudit(args: {
  readonly verb: string;
  readonly params: Record<string, unknown>;
  readonly rationale: string;
  readonly auth: AuthCtx;
  readonly db: unknown;
  readonly source: 'micro_action' | 'confirm_action';
}): Promise<ActionResponseBody> {
  const { verb, params, rationale, auth, db, source } = args;

  // 0) CONFIRM-REQUIRED policy. `/micro-action` is an AUTO-SAFE surface —
  //    the chat surfaced the chip and the user tapped it without an
  //    explicit confirmation dialog. A confirm-required verb (create_site /
  //    add_employee / create_licence / log_production creates a durable
  //    domain row; draft_payroll_run creates a non-binding payroll DRAFT)
  //    MUST NOT run there: we refuse it up front, BEFORE the gate, so an
  //    auto-safe tap can never persist a site/employee/licence/production
  //    record or a payroll draft. Such verbs run ONLY via `/confirm-action`,
  //    where the owner explicitly confirmed the action.
  if (source === 'micro_action' && requiresConfirmation(verb)) {
    moduleLogger.info('chat-actions: confirm-required verb refused on micro-action', {
      verb,
      source,
      tenantId: auth.tenantId,
    });
    return {
      success: true,
      data: { executed: false, authorized: false, reason: 'confirmation_required' },
    };
  }

  // 0b) GENERATIVE FULFILLMENT (self-evolving org). Mr. Mwikila creates tabs +
  //    action verbs DYNAMICALLY, so the deterministic registry can never
  //    enumerate every verb a generated tab might emit. A verb the registry
  //    does NOT know is a brain-GENERATED action: rather than dead-ending it as
  //    an unknown/denied verb ("dead button"), we screen the HARD rails
  //    (high-risk / inviolable / policy) and, if they clear, DEFER it to the
  //    brain's agentic turn to FULFILL — the brain that emitted the action also
  //    fulfills it, and its per-tool gates enforce the money / sovereign rails.
  //    A HARD-rail hit still denies (a brain-invented `sovereign:*` verb never
  //    defers). Confirm-required known verbs were already handled above; this
  //    branch is ONLY for verbs absent from the registry.
  if (!isKnownVerb(verb)) {
    const screen = screenGenerativeVerb(verb, rationale, buildScope(auth));
    if (!screen.allowed) {
      moduleLogger.info('chat-actions: generative verb hard-denied', {
        verb,
        source,
        tenantId: auth.tenantId,
        reason: screen.reason,
      });
      return {
        success: true,
        data: { executed: false, authorized: false, reason: screen.reason },
      };
    }
    moduleLogger.info('chat-actions: deferring generative verb to the brain', {
      verb,
      source,
      tenantId: auth.tenantId,
    });
    return {
      success: true,
      data: {
        executed: false,
        authorized: true,
        reason: 'defer_to_brain',
        deferToBrain: true,
        verb,
        params,
      },
    };
  }

  // 1) FAIL-CLOSED authorization gate FIRST. On any internal gate error
  //    the gate itself returns authorized:false (never throws an allow),
  //    so an exception here can only mean a programmer error — treat it
  //    as a denial too (defence-in-depth).
  let authorized = false;
  let reason = 'not_authorized';
  try {
    const decision = decideAutoAuthorization(verb, rationale, buildScope(auth));
    authorized = decision.authorized;
    reason = decision.reason;
  } catch (err) {
    moduleLogger.error('chat-actions: gate threw (fail-closed deny)', {
      verb,
      tenantId: auth.tenantId,
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      success: true,
      data: { executed: false, authorized: false, reason: 'gate_error_fail_closed' },
    };
  }

  if (!authorized) {
    moduleLogger.info('chat-actions: action not authorized', {
      verb,
      source,
      tenantId: auth.tenantId,
      reason,
    });
    return { success: true, data: { executed: false, authorized: false, reason } };
  }

  // 2) Dispatch to the executor registry. Unknown verb → graceful
  //    not-executed; handler error → graceful not-executed.
  const ctx: ExecContext = {
    db: db as ExecContext['db'],
    tenantId: auth.tenantId,
    userId: auth.userId,
    logger: moduleLogger as unknown as ExecContext['logger'],
  };
  const dispatch = await dispatchAction(verb, params, ctx);

  if (!dispatch.executed) {
    return {
      success: true,
      data: { executed: false, authorized: true, reason: dispatch.reason },
    };
  }

  // 3) Append the hash-chained, append-only audit row recording the
  //    executed action. Soft-fails internally (logged) so a missing audit
  //    sink never voids a completed side effect — the authorization
  //    itself already passed the gate above.
  await appendAutoAuthorizedAudit({
    db,
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: verb,
    rationale: rationale || `${source}:${verb}`,
    payload: { params, result: dispatch.result, source },
    modelVersion: null,
    logger: moduleLogger as unknown as Parameters<typeof appendAutoAuthorizedAudit>[0]['logger'],
  });

  return { success: true, data: { executed: true, result: dispatch.result } };
}

// ─── Router ──────────────────────────────────────────────────────────

const app = new Hono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

function getDbOr503(c: {
  get: (k: 'db') => unknown;
  json: (b: unknown, s?: number) => Response;
}): { db: unknown } | { error: Response } {
  const db = c.get('db');
  if (!db) {
    return {
      error: c.json(
        {
          success: false,
          error: {
            code: 'CHAT_ACTIONS_DB_UNAVAILABLE',
            message: 'Database is not configured for action execution.',
          },
        },
        503,
      ),
    };
  }
  return { db };
}

// POST /micro-action — execute a chat-surfaced micro action.
app.post('/micro-action', async (c: any) => {
  const auth = c.get('auth') as AuthCtx;
  const gotDb = getDbOr503(c);
  if ('error' in gotDb) return gotDb.error;

  const raw = await c.req.json().catch(() => null);
  const parsed = microActionSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json(
      {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid micro-action payload',
          issues: parsed.error.issues,
        },
      },
      400,
    );
  }

  const body = await gateExecuteAudit({
    verb: parsed.data.verb,
    params: parsed.data.params,
    rationale: parsed.data.rationale ?? `micro_action:${parsed.data.verb}`,
    auth,
    db: gotDb.db,
    source: 'micro_action',
  });
  return c.json(body, 200);
});

// POST /confirm-action — execute an action the user explicitly confirmed.
app.post('/confirm-action', async (c: any) => {
  const auth = c.get('auth') as AuthCtx;
  const gotDb = getDbOr503(c);
  if ('error' in gotDb) return gotDb.error;

  const raw = await c.req.json().catch(() => null);
  const parsed = confirmActionSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json(
      {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid confirm-action payload',
          issues: parsed.error.issues,
        },
      },
      400,
    );
  }

  // actionId-only path: no proposed-action store exists in the gateway
  // yet, so we cannot resolve a bare id to a verb. Return a graceful
  // not-executed envelope (200) so the FE shows "couldn't replay" rather
  // than a hard error. Inline {verb, params} is the supported path today.
  if (!parsed.data.verb) {
    return c.json(
      {
        success: true,
        data: {
          executed: false,
          authorized: false,
          reason: 'action_id_resolution_unavailable',
        },
      },
      200,
    );
  }

  const body = await gateExecuteAudit({
    verb: parsed.data.verb,
    params: parsed.data.params,
    rationale: parsed.data.rationale ?? `confirm_action:${parsed.data.verb}`,
    auth,
    db: gotDb.db,
    source: 'confirm_action',
  });
  return c.json(body, 200);
});

export const ownerChatActionsRouter = app;
export default ownerChatActionsRouter;
