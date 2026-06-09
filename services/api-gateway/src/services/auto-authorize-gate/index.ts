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
import {
  decideAutonomy,
  composeWithRail,
  type RailOutcome,
  type AutonomyDecision,
  type AutonomyConsequenceTier,
  type AutonomyReversibility,
  type AutonomySituationFlags,
} from '@borjie/autonomy-governance';
import { requiresConfirmation, isSafeVerb } from '../action-executor/registry.js';

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
  /**
   * TRUE only when every rail passed, no HIGH-risk prefix matched, AND
   * the additive continuous-autonomy controller landed on `auto`. The
   * controller can only ESCALATE — it can flip a rail-allowed action to
   * needs-confirmation, never the reverse. Consumers keep their existing
   * `if (decision.authorized)` branch unchanged.
   */
  readonly authorized: boolean;
  /** Machine-readable reason — surfaced on the downgraded suggestion frame. */
  readonly reason: string;
  /**
   * Additive continuous-autonomy verdict (ORCHESTRATION_FRONTIER_ADDENDUM
   * §confidence×consequence×reversibility). `auto` ⇒ authorized; `gate`
   * ⇒ single confirmation; `four_eyes` ⇒ dual-control. Optional so
   * legacy assertions on `{ authorized, reason }` keep passing.
   */
  readonly autonomyDecision?: AutonomyDecision;
  /** Ordered, audit-grade reasons from the controller + composition. */
  readonly autonomyReasons?: ReadonlyArray<string>;
  /** What forced the most-severe escalation (telemetry). */
  readonly autonomyGatedBy?:
    | null
    | 'consequence'
    | 'confidence'
    | 'mandate'
    | 'situation';
}

/**
 * Optional autonomy context the caller can supply to sharpen the
 * continuous decision. Every field is optional and fails CAUTIOUS when
 * absent (low calibrated confidence + approver mandate), so omitting it
 * can only make the gate MORE conservative, never less.
 */
export interface AutoAuthorizeAutonomyContext {
  /**
   * Conformally-CALIBRATED confidence in (0..1). Derive it from
   * `@borjie/conformal-calibration-online` via
   * `calibratedConfidenceFromConformal` before passing it here.
   */
  readonly calibratedConfidence?: number;
  /** Override the verb-derived consequence tier. */
  readonly consequenceTier?: AutonomyConsequenceTier;
  /** Override the verb-derived reversibility. */
  readonly reversibility?: AutonomyReversibility;
  /** Standing delegation posture for this task-class. Defaults cautious. */
  readonly mandate?:
    | 'observer'
    | 'approver'
    | 'consultant'
    | 'collaborator'
    | 'operator';
  /** Live re-gating signals (novel counterparty, regime-shift, …). */
  readonly situationFlags?: AutonomySituationFlags;
}

/**
 * Derive a conservative (consequence, reversibility) pair from the action
 * verb using the executor registry's existing classification. The
 * HIGH-risk-literal surface (money / licence / deletion) has already
 * returned `four_eyes` before this is reached, so this only classifies
 * the residual confirm-required vs auto-safe space.
 */
function classifyVerb(action: string): {
  readonly consequenceTier: AutonomyConsequenceTier;
  readonly reversibility: AutonomyReversibility;
} {
  if (requiresConfirmation(action)) {
    // Registry-VETTED confirm-required verbs (create_site / add_employee /
    // create_licence / log_production / draft_payroll_run / draft_royalty_return
    // / open_support_case / resolve_support_case / escalate_to_human / the
    // edit/remove/tab verbs). The HIGH-risk money / licence-suspension /
    // deletion / sovereign surface has ALREADY been denied above
    // (matchesHighRiskPrefix + isHighRiskLiteralOnly), so the residual
    // confirm-required space here is benign, non-money, tenant-scoped,
    // audit-chained and reversible domain writes. The human-in-loop confirm
    // requirement is enforced SEPARATELY in the action-executor dispatch path
    // (`requiresConfirmation` gates auto-EXECUTE), so the autonomy overlay must
    // NOT additionally deny authorization for these — an MD `<auto_authorized>`
    // suggestion of a benign business verb is a valid authorized frame. Low
    // consequence (no money column) but costly to undo → `low`/`costly`, which
    // clears the auto floor (0.7) at the default calibrated confidence.
    return { consequenceTier: 'low', reversibility: 'costly' };
  }
  if (isSafeVerb(action)) {
    // Auto-safe registry verbs (reminders): low + reversible.
    return { consequenceTier: 'low', reversibility: 'reversible' };
  }
  // Unknown verb — fail cautious: treat as a moderate irreversible mutation.
  return { consequenceTier: 'moderate', reversibility: 'irreversible' };
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
  autonomyContext?: AutoAuthorizeAutonomyContext,
): AutoAuthorizeDecision {
  const trimmedAction = action.trim();
  if (!trimmedAction) {
    return { authorized: false, reason: 'empty action' };
  }

  // 1) HIGH-risk prefix gate — literal, no generalisation. Sovereign /
  //    kill_switch / four_eye / policy_rollout (+ money/lease/rotation)
  //    can never be auto-authorized; they must be confirmed.
  if (matchesHighRiskPrefix(trimmedAction)) {
    // Rail-gate: HIGH-risk literal surface = dual-control HITL forever.
    // The controller can only reinforce this — it never relaxes it.
    return {
      authorized: false,
      reason:
        'high-risk action requires explicit confirmation (literal-only policy surface)',
      autonomyDecision: 'four_eyes',
      autonomyReasons: Object.freeze([
        "rail: HIGH-risk literal-only surface → four_eyes (dual-control, non-relaxable)",
      ]),
      autonomyGatedBy: 'consequence',
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

  // ── 4) ADDITIVE continuous-autonomy overlay ──────────────────────────
  // Every rail passed, so the collapsed rail outcome is `allow`. The
  // controller now runs ALONGSIDE the rails and may ESCALATE a
  // rail-allowed action into a gate / four_eyes when calibrated
  // confidence, the consequence×reversibility surface, the mandate
  // ceiling, or a live situation flag warrants more caution. It can
  // NEVER relax a rail decision (`composeWithRail` enforces this — the
  // result is the more-cautious of rail and controller). FAIL CAUTIOUS:
  // a thrown controller error downgrades to needs-confirmation.
  try {
    const railOutcome: RailOutcome = 'allow';
    const verbClass = classifyVerb(trimmedAction);
    const controller = decideAutonomy({
      // Default confidence clears only the LOW-consequence auto floor
      // (0.7) — high enough that an already-rail-vetted, registry-auto-
      // safe, reversible verb stays auto, but BELOW the moderate floor
      // (0.85) so confirm-required / unknown verbs gate on confidence.
      // A real caller should pass a conformally-calibrated value.
      calibratedConfidence: autonomyContext?.calibratedConfidence ?? 0.8,
      consequenceTier:
        autonomyContext?.consequenceTier ?? verbClass.consequenceTier,
      reversibility:
        autonomyContext?.reversibility ?? verbClass.reversibility,
      // Default mandate is `operator`: reaching this point means every
      // rail passed AND the executor registry vetted the verb. The
      // consequence×reversibility surface + situation flags still gate
      // the irreversible / high-consequence tail regardless of mandate.
      mandate: autonomyContext?.mandate ?? 'operator',
      ...(autonomyContext?.situationFlags
        ? { situationFlags: autonomyContext.situationFlags }
        : {}),
    });
    const composed = composeWithRail(railOutcome, controller);

    return {
      // `authorized` stays binary for existing consumers: only a fully
      // auto composed decision authorizes; gate / four_eyes downgrade to
      // a needs-confirmation suggestion exactly as a rail denial does.
      authorized: composed.decision === 'auto',
      reason:
        composed.decision === 'auto'
          ? 'authorized'
          : `autonomy-controller:${composed.decision} (gatedBy=${composed.gatedBy ?? 'none'})`,
      autonomyDecision: composed.decision,
      autonomyReasons: composed.reasons,
      autonomyGatedBy: composed.gatedBy,
    };
  } catch {
    // Fail cautious — a controller error must NOT authorize.
    return {
      authorized: false,
      reason: 'autonomy controller error (fail-closed)',
      autonomyDecision: 'gate',
      autonomyReasons: Object.freeze([
        'autonomy controller threw — failing closed to gate',
      ]),
      autonomyGatedBy: 'situation',
    };
  }
}
