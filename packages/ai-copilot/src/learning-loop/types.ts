/**
 * Learning-Loop types — Wave 28.
 *
 * Closed self-improvement loop:
 *
 *   outcome → memory → pattern → policy proposal → dry-run → human review → rollout
 *
 * Every type here is immutable. Repositories are narrow ports so the
 * implementation can be swapped for Postgres in production without
 * touching the orchestration logic.
 */

import type { AutonomyDomain, AutonomyPolicy } from '../autonomy/types.js';

// ---------------------------------------------------------------------------
// Outcome capture
// ---------------------------------------------------------------------------

export type OutcomeStatus = 'success' | 'failure' | 'reverted' | 'pending';

/**
 * A single recorded action-outcome pair. Emitted after an autonomous (or
 * assisted) action has been attempted. `outcome` starts as `pending` and
 * is updated later when downstream signals arrive (e.g. customer payment,
 * revert signal, human feedback score).
 */
export interface OutcomeEvent {
  readonly actionId: string;
  readonly tenantId: string;
  readonly domain: AutonomyDomain;
  readonly actionType: string;
  /** Arbitrary context features used for pattern extraction. */
  readonly context: Readonly<Record<string, unknown>>;
  /** A short label describing the decision (e.g. "auto_approve_refund"). */
  readonly decision: string;
  /** Human-readable rationale captured at decision time. */
  readonly rationale: string;
  /** 0..1 confidence at decision time. */
  readonly confidence: number;
  /** ISO-8601. */
  readonly executedAt: string;
  readonly outcome: OutcomeStatus;
  /** Optional 1..5 score from a human reviewer. */
  readonly feedbackScore?: number;
  /** Free-text observations captured post-hoc. */
  readonly observedConsequences?: string;
}

export interface OutcomeRepository {
  insert(outcome: OutcomeEvent): Promise<OutcomeEvent>;
  updateStatus(
    actionId: string,
    patch: Readonly<{
      outcome?: OutcomeStatus;
      feedbackScore?: number;
      observedConsequences?: string;
    }>,
  ): Promise<OutcomeEvent | null>;
  findByTenant(
    tenantId: string,
    filters?: Readonly<{
      domain?: AutonomyDomain;
      actionType?: string;
      since?: string;
      limit?: number;
    }>,
  ): Promise<readonly OutcomeEvent[]>;
  findByActionId(actionId: string): Promise<OutcomeEvent | null>;
}

// ---------------------------------------------------------------------------
// Reflection
// ---------------------------------------------------------------------------

/**
 * An LLM-generated post-hoc reflection on a single OutcomeEvent. Stored in
 * semantic memory so future similar decisions can recall the lesson.
 */
export interface Reflection {
  readonly actionId: string;
  readonly tenantId: string;
  readonly what: string;
  readonly why: string;
  readonly outcome: string;
  readonly lesson: string;
}

// ---------------------------------------------------------------------------
// Pattern evidence
// ---------------------------------------------------------------------------

/**
 * A statistically-significant pattern extracted from a batch of outcomes.
 * `successRate` is the pooled rate for the sub-population identified by
 * `contextFeature = contextValue`, compared to `baselineSuccessRate` for
 * all observations in the same (domain, actionType) bucket.
 */
export interface PatternEvidence {
  readonly id: string;
  readonly domain: AutonomyDomain;
  readonly actionType: string;
  readonly contextFeature: string;
  readonly contextValue: string;
  readonly sampleSize: number;
  readonly successRate: number;
  readonly baselineSuccessRate: number;
  /** Chi-squared approximation; higher = more significant. */
  readonly chiSquared: number;
  /** Convenience flag — `chiSquared >= 3.841` (95% critical value, df=1). */
  readonly significant: boolean;
  readonly discoveredAt: string;
}

// ---------------------------------------------------------------------------
// Policy proposal
// ---------------------------------------------------------------------------

export interface PolicyProposal {
  readonly id: string;
  readonly tenantId: string;
  readonly proposedPatch: Partial<AutonomyPolicy>;
  readonly evidence: readonly PatternEvidence[];
  readonly estimatedImpact: string;
  readonly reasoning: string;
  /** 0..1 proposer confidence. */
  readonly confidence: number;
  readonly status: ProposalStatus;
  readonly createdAt: string;
}

export type ProposalStatus =
  | 'draft'
  | 'dry_run_pending'
  | 'dry_run_complete'
  | 'awaiting_human_review'
  | 'approved'
  | 'rejected'
  | 'rolled_out';

export interface ProposalRepository {
  insert(proposal: PolicyProposal): Promise<PolicyProposal>;
  updateStatus(id: string, status: ProposalStatus): Promise<PolicyProposal | null>;
  findPending(tenantId: string): Promise<readonly PolicyProposal[]>;
  findById(id: string): Promise<PolicyProposal | null>;
}

// ---------------------------------------------------------------------------
// Dry-run
// ---------------------------------------------------------------------------

export interface DryRunReport {
  readonly proposalId: string;
  readonly diff: Readonly<Record<string, { before: unknown; after: unknown }>>;
  readonly simulatedOutcomes: Readonly<{
    readonly projectedSuccessRate: number;
    readonly projectedVolume: number;
    readonly estimatedImpact: string;
  }>;
  readonly warnings: readonly string[];
  readonly generatedAt: string;
}

/**
 * Minimal head-inbox port. The concrete implementation writes to the
 * exception-inbox or a dedicated Wave-28 learning-review inbox; this
 * module only needs `post`.
 */
export interface HeadInbox {
  post(input: {
    readonly tenantId: string;
    readonly subject: string;
    readonly body: string;
    readonly proposalId: string;
  }): Promise<void>;
}

// ---------------------------------------------------------------------------
// Confidence scoring
// ---------------------------------------------------------------------------

export interface ConfidenceContext {
  readonly tenantId: string;
  readonly domain: AutonomyDomain;
  readonly actionType: string;
  readonly features: Readonly<Record<string, unknown>>;
}

export interface ConfidenceScore {
  readonly value: number;
  readonly baseline: number;
  readonly llmAdjustment: number;
  readonly reasoning: string;
}

// ---------------------------------------------------------------------------
// Event-bus contract — we only need one-way subscribe. Mirrors the shape
// used by risk-recompute so we can plug into the same substrate.
// ---------------------------------------------------------------------------

export interface LearningLoopEventBus {
  subscribe(
    eventType: string,
    handler: (envelope: {
      readonly event: {
        readonly eventType: string;
        readonly eventId: string;
        readonly tenantId: string;
        readonly timestamp: string;
      } & Record<string, unknown>;
    }) => Promise<void>,
  ): () => void;
}

// ---------------------------------------------------------------------------
// Default significance threshold (chi-squared df=1, p=0.05).
// ---------------------------------------------------------------------------

export const CHI_SQUARED_SIGNIFICANCE_95 = 3.841 as const;

/** Confidence below this value forces human review regardless of policy. */
export const LOW_CONFIDENCE_THRESHOLD = 0.6 as const;
