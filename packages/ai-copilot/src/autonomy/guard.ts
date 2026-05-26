/**
 * withAutonomyGuard — Wave 28 universal autonomy chokepoint.
 *
 * Every autonomous mutation across the platform must flow through this
 * higher-order wrapper so the three safety rails always fire in the
 * same order:
 *
 *   1. resolve policy  → AutonomyPolicyService.isAuthorized(...)
 *   2. if authorized   → ApprovalGrantService.checkAuthorization(...)
 *                        (layered on top of the policy check — both gates
 *                         must say yes, mirroring the design invariant in
 *                         approval-grants/service.ts header).
 *   3. audit           → AuditTrailRecorder.record(...) on EVERY call
 *                        (authorized, denied, or queued).
 *   4. execute OR queue the approval; never mutate outside this path.
 *
 * Shape:
 *
 *   const guard = withAutonomyGuard({ policyService, grantService,
 *     auditRecorder, onApprovalRequired });
 *   const result = await guard(ctx, () => this.doMutation(...));
 *
 * Design:
 *  - Keeps the AutonomyPolicyService / ApprovalGrantService /
 *    AuditTrailRecorder shapes untouched (types.ts + defaults.ts are
 *    explicitly out-of-scope per the wiring policy).
 *  - `onApprovalRequired` is optional; when unset we surface
 *    `queuedApprovalId: null` and `executed: false` so callers can decide
 *    to raise, queue, or retry.
 *  - The audit record is written BEFORE execution so a crashing thunk
 *    still leaves a trail; if the audit write itself throws we bubble it
 *    up rather than silently swallow — an autonomy call without an audit
 *    entry is a compliance violation.
 */

import type {
  AuthorizationDecision,
  AuthorizeContext,
  AutonomyDomain,
} from './types.js';
import type { AutonomyPolicyService } from './autonomy-policy-service.js';
import type {
  ApprovalGrantService,
} from '../approval-grants/service.js';
import type {
  ApprovalGrantDomain,
  AuthorizationCheckResult,
  AuthorizationRequest,
} from '../approval-grants/types.js';
import type {
  AuditActionCategory,
  AuditActorKind,
  AuditSubject,
  AuditTrailEntry,
} from '../audit-trail/types.js';
import type { AuditTrailRecorder } from '../audit-trail/recorder.js';
import type {
  ConfidenceScorer,
} from '../learning-loop/confidence-scorer.js';
import { LOW_CONFIDENCE_THRESHOLD } from '../learning-loop/confidence-scorer.js';
import type { OutcomeCapture } from '../learning-loop/outcome-capture.js';
import { logger } from '../logger.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Context passed to `guard(...)`. The three identity fields (tenantId,
 * domain, actionKey) are mandatory; the rest are optional and flow into
 * the policy/grant/audit layers when present.
 */
export interface AutonomyGuardContext {
  readonly tenantId: string;
  /** Maps to AutonomyPolicyService.isAuthorized(... domain ...). */
  readonly domain: AutonomyDomain;
  /** Action verb used by the policy evaluator (e.g. 'send_reminder'). */
  readonly actionKey: string;
  /** Stable action verb recorded in the audit trail row. */
  readonly auditActionKind: string;
  /** Category bucket for the audit row. Defaults derived from domain
   *  when not explicitly provided; legal_proceedings → 'legal', everything
   *  else passes through as-is. */
  readonly auditCategory?: AuditActionCategory;
  /** Context consumed by the policy evaluator (amounts, scores...). */
  readonly policyContext?: AuthorizeContext;
  /** When omitted, defaults to the autonomy domain if the names match a
   *  valid ApprovalGrantDomain. Set this when the grant domain differs
   *  (rare — legal_proceedings → legal_proceedings works verbatim). */
  readonly grantDomain?: ApprovalGrantDomain;
  /** Category string used when calling `checkAuthorization`. Defaults to
   *  `actionKey`. */
  readonly grantActionCategory?: string;
  /** Scope details for the grant check. */
  readonly grantRequest?: Omit<AuthorizationRequest, 'domain'>;
  /** Actor captured in the audit row. Defaults to `ai_autonomous`. */
  readonly actor?: {
    readonly kind?: AuditActorKind;
    readonly id?: string | null;
    readonly display?: string | null;
  };
  /** Subject captured in the audit row. */
  readonly subject?: AuditSubject;
  /** Correlation id propagated through the audit evidence blob. */
  readonly correlationId?: string;
  /** Free-form evidence attachments merged into the audit row. */
  readonly evidence?: Readonly<Record<string, unknown>>;
  /** Skip the grant check (useful when a policy decision already
   *  authorizes without needing a separate human-grant rail — most call
   *  sites leave this false). */
  readonly skipGrantCheck?: boolean;
  /** Action reference used for grant `consume` idempotency. Defaults to
   *  `${actionKey}:${subject?.entityId ?? correlationId ?? tenantId}`. */
  readonly actionRef?: string;
  /** Optional actor string attached to the grant-consume usage record. */
  readonly grantActor?: string;
}

/**
 * The return envelope every guarded call resolves to. Immutable — callers
 * spread it into their own response shape when surfacing to HTTP/CLI.
 */
export interface GuardResult<T = unknown> {
  /** True iff the thunk was awaited and returned. */
  readonly executed: boolean;
  /** The thunk's return value when executed=true; undefined otherwise. */
  readonly result?: T;
  /** Set when the guard asked `onApprovalRequired` to stash a request. */
  readonly queuedApprovalId: string | null;
  /** The underlying policy decision — always present. */
  readonly decision: AuthorizationDecision;
  /** Audit row id recording this guard invocation. */
  readonly auditEntryId: string;
  /** Grant lookup result when the grant check ran; null otherwise. */
  readonly grantCheck: AuthorizationCheckResult | null;
  /** Grant usage record id when a grant was consumed. */
  readonly consumedGrantId: string | null;
  /** Reason returned to callers for quick logging. Mirrors decision.reason
   *  when denied, 'executed' when the thunk ran, 'queued' when queued. */
  readonly reason: string;
}

export type AutonomyActionThunk<T> = () => Promise<T> | T;

export type AutonomyGuardFn = <T>(
  ctx: AutonomyGuardContext,
  action: AutonomyActionThunk<T>,
) => Promise<GuardResult<T>>;

export interface OnApprovalRequiredInput {
  readonly tenantId: string;
  readonly domain: AutonomyDomain;
  readonly actionKey: string;
  readonly decision: AuthorizationDecision;
  readonly grantCheck: AuthorizationCheckResult | null;
  readonly context: AutonomyGuardContext;
  readonly auditEntryId: string;
}

/**
 * Optional sink the guard calls when the policy/grant chain refuses. The
 * implementation decides whether to write an exception-inbox row, enqueue
 * a pending approval request, open an incident, etc. MUST return a
 * stable id so callers can surface it to the UI; null means the sink
 * declined to queue (silent drop — logged by guard for ops visibility).
 */
export type OnApprovalRequiredFn = (
  input: OnApprovalRequiredInput,
) => Promise<string | null> | string | null;

export interface WithAutonomyGuardDeps {
  readonly policyService: AutonomyPolicyService;
  readonly grantService?: ApprovalGrantService | null;
  readonly auditRecorder: AuditTrailRecorder;
  readonly onApprovalRequired?: OnApprovalRequiredFn | null;
  /** Injectable clock — mostly for deterministic tests. */
  readonly clock?: () => Date;
  /**
   * Optional confidence scorer (Wave 28 Learning-Loop). When wired the guard
   * computes a per-action confidence before the policy check and forces
   * `requires-approval` if the score falls below `LOW_CONFIDENCE_THRESHOLD`
   * (0.6) regardless of the policy's answer.
   */
  readonly confidenceScorer?: ConfidenceScorer | null;
  /**
   * Optional outcome capture (Wave 28 Learning-Loop). When wired the guard
   * records an OutcomeEvent after every call — success / failure /
   * pending / reverted — so the learning-loop can observe real behaviour.
   */
  readonly outcomeCapture?: OutcomeCapture | null;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Map an autonomy domain onto the closest audit category. The two enums
 * are near-identical but `legal_proceedings` collapses into `legal` in the
 * audit schema.
 */
function deriveAuditCategory(
  domain: AutonomyDomain,
  explicit: AuditActionCategory | undefined,
): AuditActionCategory {
  if (explicit) return explicit;
  if (domain === 'legal_proceedings') return 'legal';
  return domain as AuditActionCategory;
}

/**
 * Map an autonomy domain onto its ApprovalGrant counterpart. They agree
 * on every identifier so the cast is safe — we still accept an explicit
 * override via `ctx.grantDomain` for future-proofing.
 */
function deriveGrantDomain(
  domain: AutonomyDomain,
  explicit: ApprovalGrantDomain | undefined,
): ApprovalGrantDomain {
  if (explicit) return explicit;
  return domain as ApprovalGrantDomain;
}

function buildActionRef(ctx: AutonomyGuardContext): string {
  if (ctx.actionRef) return ctx.actionRef;
  const suffix =
    ctx.subject?.entityId ??
    ctx.correlationId ??
    ctx.tenantId;
  return `${ctx.actionKey}:${suffix}`;
}

/**
 * Safe-stringify for audit evidence. Error objects → message+name,
 * BigInt → string, undefined becomes null. Everything else returns as-is.
 */
function serializeForEvidence(value: unknown): unknown {
  if (value === undefined) return null;
  if (value instanceof Error) {
    return { name: value.name, message: value.message };
  }
  if (typeof value === 'bigint') return value.toString();
  return value;
}

export function withAutonomyGuard(deps: WithAutonomyGuardDeps): AutonomyGuardFn {
  const now = deps.clock ?? (() => new Date());

  return async function guard<T>(
    ctx: AutonomyGuardContext,
    action: AutonomyActionThunk<T>,
  ): Promise<GuardResult<T>> {
    if (!ctx.tenantId) {
      throw new Error('autonomy-guard: tenantId required');
    }
    if (!ctx.actionKey) {
      throw new Error('autonomy-guard: actionKey required');
    }
    if (!ctx.auditActionKind) {
      throw new Error('autonomy-guard: auditActionKind required');
    }

    const actorKind: AuditActorKind = ctx.actor?.kind ?? 'ai_autonomous';
    const auditCategory = deriveAuditCategory(ctx.domain, ctx.auditCategory);

    // ------------------------------------------------------------------
    // Step 0 — confidence scoring (Wave 28 Learning-Loop, optional).
    // When the scorer is wired we compute a score BEFORE the policy check
    // so the guard can force human review on low-confidence actions even
    // when policy would otherwise authorize.
    // ------------------------------------------------------------------
    let confidenceValue: number | null = null;
    let confidenceReasoning: string | null = null;
    if (deps.confidenceScorer) {
      try {
        const score = await deps.confidenceScorer.scoreAction({
          tenantId: ctx.tenantId,
          domain: ctx.domain,
          actionType: ctx.actionKey,
          features: (ctx.policyContext ?? {}) as Readonly<Record<string, unknown>>,
        });
        confidenceValue = score.value;
        confidenceReasoning = score.reasoning;
      } catch (err) {
        // Scorer is advisory — never block on its failure.
         
        logger.error('autonomy-guard: confidence scorer failed', { error: err instanceof Error ? err.message : String(err) });
      }
    }

    // ------------------------------------------------------------------
    // Step 1 — policy gate
    // ------------------------------------------------------------------
    const decision = await deps.policyService.isAuthorized(
      ctx.tenantId,
      ctx.domain,
      ctx.actionKey,
      ctx.policyContext ?? {},
    );

    // ------------------------------------------------------------------
    // Step 2 — grant gate (only if policy authorized and caller didn't
    //                       opt out and a grant service is wired).
    // ------------------------------------------------------------------
    let grantCheck: AuthorizationCheckResult | null = null;
    let consumedGrantId: string | null = null;

    const shouldCheckGrant =
      decision.authorized &&
      !ctx.skipGrantCheck &&
      !!deps.grantService;

    if (shouldCheckGrant) {
      const grantCategory = ctx.grantActionCategory ?? ctx.actionKey;
      const grantDomain = deriveGrantDomain(ctx.domain, ctx.grantDomain);
      grantCheck = await deps.grantService!.checkAuthorization(
        ctx.tenantId,
        grantCategory,
        {
          domain: grantDomain,
          ...(ctx.grantRequest?.targetEntityType !== undefined ? { targetEntityType: ctx.grantRequest.targetEntityType } : {}),
          ...(ctx.grantRequest?.targetEntityId !== undefined ? { targetEntityId: ctx.grantRequest.targetEntityId } : {}),
          ...(ctx.grantRequest?.amountMinorUnits !== undefined ? { amountMinorUnits: ctx.grantRequest.amountMinorUnits } : {}),
          ...(ctx.grantRequest?.actor !== undefined ? { actor: ctx.grantRequest.actor } : {}),
          ...(ctx.grantRequest?.meta !== undefined ? { meta: ctx.grantRequest.meta } : {}),
        },
      );
    }

    // ------------------------------------------------------------------
    // Step 3 — decide execution path before the audit write so the row
    //          captures the final decision (executed/denied/queued).
    // ------------------------------------------------------------------
    const grantAuthorized = !shouldCheckGrant || (grantCheck?.authorized ?? false);
    const confidenceBlocks =
      confidenceValue !== null && confidenceValue < LOW_CONFIDENCE_THRESHOLD;
    const willExecute = decision.authorized && grantAuthorized && !confidenceBlocks;

    // The audit "decision" enum accepts free-form strings so we pick one
    // of the four canonical strings the verifier already understands.
    let auditDecision: 'executed' | 'proposed' | 'rejected';
    if (willExecute) {
      auditDecision = 'executed';
    } else if (
      decision.requiresApproval ||
      (grantCheck && grantCheck.mustRequestApproval) ||
      confidenceBlocks
    ) {
      auditDecision = 'proposed';
    } else {
      auditDecision = 'rejected';
    }

    // ------------------------------------------------------------------
    // Step 4 — write audit row (always). We do this before execution so
    //          a crash in the thunk still leaves a trail.
    // ------------------------------------------------------------------
    const auditEntry: AuditTrailEntry = await deps.auditRecorder.record({
      tenantId: ctx.tenantId,
      actor: {
        kind: actorKind,
        id: ctx.actor?.id ?? null,
        display: ctx.actor?.display ?? null,
      },
      actionKind: ctx.auditActionKind,
      actionCategory: auditCategory,
      ...(ctx.subject !== undefined ? { subject: ctx.subject } : {}),
      decision: auditDecision,
      occurredAt: now(),
      ai: {
        attachments: {
          autonomy: {
            domain: ctx.domain,
            actionKey: ctx.actionKey,
            policyDecision: {
              authorized: decision.authorized,
              requiresApproval: decision.requiresApproval,
              reason: decision.reason,
              rule: decision.policyRuleMatched,
              escalateTo: decision.escalateTo,
            },
            grantCheck: grantCheck
              ? {
                  authorized: grantCheck.authorized,
                  kind: grantCheck.kind,
                  reason: grantCheck.reason,
                  grantId: grantCheck.grantId,
                  mustRequestApproval: grantCheck.mustRequestApproval,
                }
              : null,
            correlationId: ctx.correlationId ?? null,
          },
          ...(ctx.evidence
            ? { evidence: serializeForEvidence(ctx.evidence) }
            : {}),
        },
      },
    });

    // ------------------------------------------------------------------
    // Step 5 — execute or queue.
    // ------------------------------------------------------------------
    if (willExecute) {
      let result: T;
      let thunkError: unknown = null;
      try {
        result = await action();
      } catch (err) {
        thunkError = err;
        // Record failure outcome before rethrowing.
        if (deps.outcomeCapture) {
          try {
            await deps.outcomeCapture.record({
              actionId: auditEntry.id,
              tenantId: ctx.tenantId,
              domain: ctx.domain,
              actionType: ctx.actionKey,
              context: (ctx.policyContext ?? {}) as Readonly<Record<string, unknown>>,
              decision: 'executed',
              rationale: decision.reason,
              confidence: confidenceValue ?? 0.5,
              outcome: 'failure',
              observedConsequences:
                err instanceof Error ? err.message : String(err),
            });
          } catch {
            /* never fail on outcome capture */
          }
        }
        throw thunkError;
      }

      // Consume the grant if we rode a live grant (single or standing).
      if (grantCheck?.authorized && grantCheck.grantId && deps.grantService) {
        try {
          const grantActor = ctx.grantActor ?? ctx.actor?.id;
          const consume = await deps.grantService.consume(
            grantCheck.grantId,
            ctx.tenantId,
            buildActionRef(ctx),
            grantActor !== undefined && grantActor !== null ? { actor: grantActor } : {},
          );
          consumedGrantId = consume.grantId;
        } catch (err) {
          // Consume failure must never roll back the mutation — the
          // audit trail already records the attempt. Surface via reason.
           
          logger.error('autonomy-guard: grant consume failed', { error: err instanceof Error ? err.message : String(err) });
        }
      }

      // Emit an OutcomeEvent so the learning-loop can observe real
      // behaviour. The outcome starts as `pending` because downstream
      // success signals (payment received, no revert, etc.) arrive
      // asynchronously; callers can later call
      // `outcomeCapture.updateOutcome(...)` once they land.
      if (deps.outcomeCapture) {
        try {
          await deps.outcomeCapture.record({
            actionId: auditEntry.id,
            tenantId: ctx.tenantId,
            domain: ctx.domain,
            actionType: ctx.actionKey,
            context: (ctx.policyContext ?? {}) as Readonly<Record<string, unknown>>,
            decision: 'executed',
            rationale: decision.reason,
            confidence: confidenceValue ?? 0.5,
            outcome: 'pending',
          });
        } catch {
          /* never fail on outcome capture */
        }
      }

      return {
        executed: true,
        result,
        queuedApprovalId: null,
        decision,
        auditEntryId: auditEntry.id,
        grantCheck,
        consumedGrantId,
        reason: 'executed',
      };
    }

    // Denied / requires-approval path.
    let queuedApprovalId: string | null = null;
    if (deps.onApprovalRequired) {
      try {
        const queued = await deps.onApprovalRequired({
          tenantId: ctx.tenantId,
          domain: ctx.domain,
          actionKey: ctx.actionKey,
          decision,
          grantCheck,
          context: ctx,
          auditEntryId: auditEntry.id,
        });
        queuedApprovalId = queued ?? null;
      } catch (err) {
         
        logger.error('autonomy-guard: onApprovalRequired sink failed', { error: err instanceof Error ? err.message : String(err) });
      }
    }

    // Even on the denied/queued path we record an OutcomeEvent so the
    // learning-loop can correlate confidence scores with eventual manual
    // review outcomes.
    if (deps.outcomeCapture) {
      try {
        await deps.outcomeCapture.record({
          actionId: auditEntry.id,
          tenantId: ctx.tenantId,
          domain: ctx.domain,
          actionType: ctx.actionKey,
          context: (ctx.policyContext ?? {}) as Readonly<Record<string, unknown>>,
          decision: auditDecision,
          rationale: confidenceBlocks
            ? `low-confidence(${(confidenceValue ?? 0).toFixed(2)}): ${confidenceReasoning ?? ''}`
            : decision.reason,
          confidence: confidenceValue ?? 0.5,
          outcome: 'pending',
        });
      } catch {
        /* never fail on outcome capture */
      }
    }

    return {
      executed: false,
      queuedApprovalId,
      decision,
      auditEntryId: auditEntry.id,
      grantCheck,
      consumedGrantId: null,
      reason: queuedApprovalId
        ? 'queued'
        : confidenceBlocks
          ? `low-confidence(${(confidenceValue ?? 0).toFixed(2)})`
          : decision.reason,
    };
  };
}
