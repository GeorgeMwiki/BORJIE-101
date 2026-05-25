/**
 * Proactive initiation loop — types.
 *
 * Wave 28 — the "signal → proposal → approval → execute" chain that turns
 * streaming AI-native SIGNALS into governed, auditable ACTIONS.
 *
 * A Signal is a normalized event emitted by one of the AI-native capability
 * sources (market-surveillance, sentiment-monitor, predictive-interventions,
 * pattern-mining). The orchestrator matches each Signal to a Proposal
 * template, drafts a Proposal, runs it through the autonomy policy, and
 * either auto-executes or parks for head approval.
 *
 * ProposalOutcome closes the loop so downstream observers (audit trail,
 * metrics) see the final disposition.
 *
 * Everything here is immutable — no mutation, no default exports; align
 * with the codebase's functional style.
 */
import type { AutonomyDomain } from '../autonomy/types.js';

/**
 * Free-form severity — each source maps its own scale onto this low/med/high
 * trichotomy so the orchestrator can prioritise without deep-coupling to
 * every emitter's scale.
 */
export type SignalSeverity = 'low' | 'medium' | 'high' | 'critical';

/**
 * Canonical source identifiers. Kept as a string union (not a plain string)
 * so adding a new source is an explicit code change, not a runtime surprise.
 */
export type SignalSourceId =
  | 'market-surveillance'
  | 'sentiment-monitor'
  | 'predictive-interventions'
  | 'pattern-mining'
  // Wave 29 — forecasting package emits graph-signal inputs directly.
  | 'forecasting';

export interface Signal {
  readonly signalId: string;
  readonly source: SignalSourceId;
  readonly tenantId: string;
  readonly domain: AutonomyDomain;
  readonly severity: SignalSeverity;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly detectedAt: string;
}

/**
 * Why a proposal requires human approval. Either:
 *  - policy_threshold  — an autonomy policy threshold was crossed
 *  - low_confidence    — the draft's confidence was below the auto-approve floor
 *  - safety_critical   — the template is tagged safety_critical (never auto-run)
 *  - shadow_mode       — tenant has shadow mode enabled for the domain
 *  - null              — not required; auto-execute path
 */
export type ApprovalReason =
  | 'policy_threshold'
  | 'low_confidence'
  | 'safety_critical'
  | 'shadow_mode'
  | null;

export interface Proposal {
  readonly proposalId: string;
  readonly signalId: string;
  readonly tenantId: string;
  readonly domain: AutonomyDomain;
  readonly templateId: string;
  readonly title: string;
  readonly rationale: string;
  readonly suggestedAction: string;
  readonly estimatedImpact: Readonly<{
    readonly metric: string;
    readonly magnitude: number;
    readonly unit: string;
  }>;
  readonly confidence: number; // [0, 1]
  readonly requiresApprovalBecause: ApprovalReason;
  readonly draftedAt: string;
}

export type ProposalOutcomeKind =
  | 'auto_executed'
  | 'approved_and_executed'
  | 'rejected'
  | 'expired';

export interface ProposalOutcome {
  readonly proposalId: string;
  readonly outcome: ProposalOutcomeKind;
  readonly executedAt: string | null;
  readonly note: string | null;
}

/**
 * Audit event emitted on every orchestrator decision. Thin struct — the
 * heavy recording goes through the autonomous-action-audit repository
 * owned by the autonomy subtree.
 */
export interface ProactiveAuditEvent {
  readonly kind:
    | 'proposal_drafted'
    | 'proposal_auto_executed'
    | 'proposal_awaiting_approval'
    | 'proposal_rejected'
    | 'proposal_expired';
  readonly proposalId: string;
  readonly tenantId: string;
  readonly domain: AutonomyDomain;
  readonly occurredAt: string;
  readonly detail: Readonly<Record<string, unknown>>;
}

/**
 * Executor port — the orchestrator calls this to actually run an approved
 * proposal. Implementations wrap the task-agents executor or a specific
 * orchestrator (vacancy-pipeline, arrears-ladder, etc.).
 */
export interface ProposalExecutor {
  execute(proposal: Proposal): Promise<ProposalOutcome>;
}

export interface ProactiveAuditSink {
  record(event: ProactiveAuditEvent): Promise<void> | void;
}
