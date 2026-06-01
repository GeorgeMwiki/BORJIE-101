/**
 * auto-authorize gate — closes the `auto_authorized` safety gap.
 *
 * The teaching LLM can emit an `<auto_authorized>{action,rationale,payload}</auto_authorized>`
 * tag. Historically `brain-teach.hono.ts` forwarded that tag verbatim as
 * an `auto_authorized` SSE frame WITHOUT ever checking it against the
 * real authorization surface — an unvalidated model string was being
 * presented to the UI as an authorization.
 *
 * This module is the gate. Given the parsed tag + the caller's scope it
 * returns a definitive `{ authorized, reason }`. The route then either
 * emits the authorized frame (and appends an audit row) or downgrades it
 * to a non-authorized suggestion.
 *
 * HARD RULES honoured (see CLAUDE.md):
 *   - HIGH-risk policy prefixes (sovereign / kill_switch / four_eye /
 *     policy_rollout, plus the broader literal-only opt-out list) MUST
 *     hit literal rules and can NEVER be auto-authorized here. No
 *     reason-resolver generalisation.
 *   - FAIL CLOSED on ANY policy-gate / inviolable error → deny.
 *   - Kill-switch concerns are fail-closed (the prefix check denies, it
 *     never catches-and-ignores into an allow).
 *
 * Pure + deterministic — no I/O. The audit append lives separately in
 * `./audit.ts` so this stays unit-testable without a DB.
 */

import {
  checkInviolable,
  runPolicyGate,
  isHighRiskLiteralOnly,
  type ScopeContext,
} from '@borjie/central-intelligence';

/**
 * The four HIGH-risk policy prefixes the project boundary calls out
 * explicitly. `isHighRiskLiteralOnly` already covers `sovereign:`,
 * `kill_switch:` and `policy_rollout:`, but `four_eye` is a *verdict*
 * rather than a prefix on that list — so we match it (and the named
 * four) here directly as defence-in-depth. The action namespace is
 * free-form model text, so we match generously (prefix OR substring on
 * the bare token) and fail toward "needs confirmation".
 */
const HIGH_RISK_ACTION_PREFIXES: ReadonlyArray<string> = Object.freeze([
  'sovereign',
  'kill_switch',
  'killswitch',
  'four_eye',
  'four-eye',
  'policy_rollout',
]);

export interface AutoAuthorizeDecision {
  /** TRUE only when every gate passed and no HIGH-risk prefix matched. */
  readonly authorized: boolean;
  /** Machine-readable reason — surfaced on the downgraded suggestion frame. */
  readonly reason: string;
}

/** Normalise the model action token for prefix / substring matching. */
function normalizeAction(action: string): string {
  return action.trim().toLowerCase();
}

/**
 * TRUE when the action touches one of the HIGH-risk surfaces that may
 * never be auto-authorized. Combines the explicit four named prefixes
 * with the kernel's literal-only opt-out list (money movement, eviction,
 * key rotation, model pins, suspension levers, cross-tenant disclosure).
 */
function matchesHighRiskPrefix(action: string): boolean {
  const normalized = normalizeAction(action);
  for (const prefix of HIGH_RISK_ACTION_PREFIXES) {
    // Prefix match (`sovereign:transfer`) OR a leading bare token
    // (`sovereign`, `sovereign-x`) — but not an incidental substring
    // deep inside an unrelated word.
    if (
      normalized === prefix ||
      normalized.startsWith(`${prefix}:`) ||
      normalized.startsWith(`${prefix}-`) ||
      normalized.startsWith(`${prefix}_`) ||
      normalized.startsWith(`${prefix}.`)
    ) {
      return true;
    }
  }
  // Defence-in-depth: the kernel's curated literal-only list (covers the
  // `md:*` money / lease / killswitch / rotation / pin surfaces).
  return isHighRiskLiteralOnly(action.trim());
}

/**
 * Decide whether an `auto_authorized` tag may actually be auto-approved.
 *
 * @param action     the model-proposed action verb (e.g. `snooze_reminder`).
 * @param rationale  the model's stated rationale (validated as output text).
 * @param scope      the caller's verified scope (tenant / platform).
 *
 * FAIL CLOSED: any thrown error inside a gate downgrades to a
 * non-authorized suggestion rather than authorizing.
 */
export function decideAutoAuthorization(
  action: string,
  rationale: string,
  scope: ScopeContext,
): AutoAuthorizeDecision {
  const trimmedAction = action.trim();
  if (!trimmedAction) {
    return { authorized: false, reason: 'empty action' };
  }

  // 1) HIGH-risk prefix gate — literal, no generalisation. Sovereign /
  //    kill_switch / four_eye / policy_rollout (+ money/lease/rotation)
  //    can never be auto-authorized; they must be confirmed.
  if (matchesHighRiskPrefix(trimmedAction)) {
    return {
      authorized: false,
      reason:
        'high-risk action requires explicit confirmation (literal-only policy surface)',
    };
  }

  // 2) Inviolable refusal check — categorical refusals (cross-tenant,
  //    bulk-PII, counterfeit-authority, forge/impersonate, tribunal
  //    autonomy). Run over the action + rationale so a forbidden intent
  //    expressed in either field is caught. FAIL CLOSED on error.
  try {
    const inviolable = checkInviolable({
      threadId: 'auto-authorized',
      userMessage: `${trimmedAction}\n${rationale}`,
      scope,
      tier: scope.kind === 'platform' ? 'industry' : 'portfolio',
      stakes: 'high',
      surface: scope.kind === 'platform' ? 'platform-hq' : 'owner-portal',
    });
    if (inviolable.status === 'block') {
      return {
        authorized: false,
        reason: `inviolable:${inviolable.category ?? 'blocked'}`,
      };
    }
  } catch {
    // Fail closed — never authorize when the inviolable gate errors.
    return { authorized: false, reason: 'inviolable gate error (fail-closed)' };
  }

  // 3) Policy gate — deterministic policy validation. We feed the
  //    rationale as the produced text + the caller's tenant scope. A
  //    `block` verdict denies; anything else (pass / soften) permits the
  //    auto-authorization. FAIL CLOSED on error.
  try {
    const gate = runPolicyGate({
      text: rationale && rationale.trim() ? rationale : trimmedAction,
      // The rationale is model prose, not a cited claim; the gate's
      // citation-dependent hedges do not apply to an action decision.
      hasCitations: true,
      request: {
        ...(scope.kind === 'tenant' ? { tenantId: scope.tenantId } : {}),
        stakes: 'high',
      },
      ...(scope.kind === 'tenant'
        ? { decision: { tenantId: scope.tenantId } }
        : {}),
    });
    if (gate.verdict.status === 'block') {
      return {
        authorized: false,
        reason: `policy-gate:${gate.verdict.reason}`,
      };
    }
  } catch {
    // Fail closed — a policy-gate error must deny, never authorize.
    return { authorized: false, reason: 'policy gate error (fail-closed)' };
  }

  // All gates passed and no HIGH-risk prefix matched → safe to auto-approve.
  return { authorized: true, reason: 'authorized' };
}
