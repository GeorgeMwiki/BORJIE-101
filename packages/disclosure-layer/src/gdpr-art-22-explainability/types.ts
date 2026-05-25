/**
 * GDPR Art. 22 counterfactual-explainability types.
 *
 * Source: .research/r-ip-disclosure-capability-explanation-frontier.md §5
 *
 * GDPR Art 22: data subjects have the right to a meaningful explanation
 * of automated decisions producing legal/significant effects.
 * Counterfactuals are the explainability gold standard:
 *   "Your X request was denied. If your last 6 X had been Y, we would
 *    have approved."
 *
 * Counterfactuals are IP-safe because they depend ONLY on tenant data,
 * never on model internals.
 */

/**
 * A consequential decision the Brain made or recommended.
 * Tenant-data only — never references model internals.
 */
export interface DecisionEvent {
  /** Opaque audit identifier (e.g. dec-2026-05-19-77a3b9). */
  readonly id: string;
  /** Decision kind — kept generic to support all domain decisions. */
  readonly kind:
    | 'rent_waiver'
    | 'screening'
    | 'eviction_recommendation'
    | 'deposit_deduction'
    | 'lease_termination'
    | 'maintenance_priority'
    | 'rent_adjustment';
  /** Outcome handed back to the principal. */
  readonly outcome: 'approve' | 'deny' | 'flag-for-review' | 'auto-approve' | 'auto-deny';
  /** Account-rule / policy identifier that was invoked. */
  readonly policyInvoked: string;
  /** Observed inputs that the policy evaluated. */
  readonly inputs: ReadonlyArray<DecisionInput>;
  /** Audit trail timestamp (ISO 8601). */
  readonly timestamp: string;
  /** Identifier of the principal affected. */
  readonly affectedPrincipalId: string;
}

/**
 * A single named input observed for a decision. The threshold field is
 * the *user-facing* policy boundary (e.g. "days_late <= 5"), NEVER the
 * model's internal confidence threshold.
 */
export interface DecisionInput {
  /** Human-readable name (e.g. "days_late", "payment_history"). */
  readonly name: string;
  /** Observed value, stringified for display safety. */
  readonly observedValue: string;
  /** Threshold the policy required (e.g. "<= 5"). */
  readonly requiredThreshold: string;
  /** Whether this input passed the policy requirement. */
  readonly passed: boolean;
}

/**
 * A counterfactual — what would have flipped the outcome.
 */
export interface CounterfactualClause {
  /** Which input would need to change. */
  readonly inputName: string;
  /** What it would need to be. */
  readonly hypotheticalValue: string;
  /** What the outcome would have been. */
  readonly hypotheticalOutcome: DecisionEvent['outcome'];
}

/**
 * Full counterfactual-explanation card returned to the principal.
 */
export interface Counterfactual {
  readonly decisionId: string;
  readonly humanSummary: string;
  readonly policyInvoked: string;
  readonly observed: ReadonlyArray<DecisionInput>;
  readonly counterfactuals: ReadonlyArray<CounterfactualClause>;
  readonly recoursePath: {
    readonly canOverride: boolean;
    readonly canRequestHumanReview: boolean;
    readonly canChangeRule: boolean;
  };
  readonly disclaimer: string;
}
