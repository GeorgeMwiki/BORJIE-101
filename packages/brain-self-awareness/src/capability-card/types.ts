// Capability Card — types & ports
// "What can/can't I do right now?" — surfaceable to operators

/**
 * Coarse-grained autonomy scope a brain instance is operating under.
 * READ_ONLY = explain / observe / propose only
 * SUGGEST = propose actions but never execute
 * EXECUTE_WITH_APPROVAL = execute after explicit human approval per action
 * EXECUTE_AUTONOMOUSLY = execute within an allow-listed safe envelope
 */
export type AutonomyScope =
  | 'READ_ONLY'
  | 'SUGGEST'
  | 'EXECUTE_WITH_APPROVAL'
  | 'EXECUTE_AUTONOMOUSLY'

/**
 * Calibrated soft limits the brain has learned about itself.
 * Numbers are 0..1 unless otherwise stated.
 */
export interface CalibratedLimits {
  /** Estimated p(success) on tasks the brain claims it CAN do. */
  readonly confidenceFloor: number
  /** Estimated p(false-positive) on the brain's "I can do this" claim. */
  readonly overconfidenceRate: number
  /** Max number of in-flight flows the brain considers safe to run in parallel. */
  readonly maxConcurrentFlows: number
  /** Max single-action $USD cost the brain will execute without an approver. */
  readonly maxAutonomousActionCostUsd: number
}

/**
 * Pointer to a flow the brain is presently driving (or paused on).
 */
export interface OngoingFlow {
  readonly flowId: string
  readonly kind: string
  readonly startedAt: string
  readonly statusHint: 'running' | 'paused' | 'awaiting-approval' | 'awaiting-data'
}

/**
 * Recent decision summary — surfaced for operator review.
 * Full provenance lives in the decision-provenance store.
 */
export interface RecentDecisionSummary {
  readonly decisionId: string
  readonly actionKind: string
  readonly outcome: 'approved' | 'rejected' | 'self-blocked' | 'executed'
  readonly at: string
}

/**
 * A skill the brain proposes adding to its repertoire.
 */
export interface SuggestedNextSkill {
  readonly name: string
  readonly rationale: string
  readonly estimatedFrequencyPerWeek: number
}

/**
 * The full capability card — the brain's self-portrait at a moment.
 * Pure data; UI / surfacing handled downstream.
 */
export interface CapabilityCard {
  readonly autonomyScope: AutonomyScope
  /** Short brand for the scope, e.g. "Approval-gated". */
  readonly cap: string
  /** Human-readable skill names the brain currently can perform. */
  readonly canDo: readonly string[]
  /** Skills explicitly OFF — disabled by policy, missing tools, or self-disabled. */
  readonly cantDo: readonly string[]
  readonly ongoingFlows: readonly OngoingFlow[]
  readonly recentDecisions: readonly RecentDecisionSummary[]
  readonly suggestedNext: readonly SuggestedNextSkill[]
  readonly calibratedLimits: CalibratedLimits
  /** ISO timestamp the card was built. */
  readonly builtAt: string
}

/**
 * Skill registry port — duck-typed for portability.
 */
export interface ISkillRegistry {
  listEnabled(): Promise<readonly { name: string }[]>
  listDisabled(): Promise<readonly { name: string; reason: string }[]>
}

/**
 * Decision store port — read-only here; append lives in decision-provenance.
 */
export interface IDecisionStore {
  listRecent(opts: {
    readonly limit: number
  }): Promise<readonly RecentDecisionSummary[]>
}

/**
 * Flow registry port — current in-flight flows.
 */
export interface IFlowRegistry {
  listOngoing(): Promise<readonly OngoingFlow[]>
}

/**
 * Automation suggester port — read-only suggestions surfaced on the card.
 */
export interface IAutomationSuggester {
  listSuggestions(): Promise<readonly SuggestedNextSkill[]>
}

/**
 * Calibration port — yields the brain's current calibrated limits.
 */
export interface ICalibrationSource {
  getLimits(): Promise<CalibratedLimits>
}

/**
 * Dependencies required to build a capability card.
 */
export interface CapabilityCardDeps {
  readonly skills: ISkillRegistry
  readonly decisions: IDecisionStore
  readonly flows: IFlowRegistry
  readonly suggester: IAutomationSuggester
  readonly calibration: ICalibrationSource
  readonly autonomyScope: AutonomyScope
  /** Optional clock — defaults to system time. Pass a fake in tests. */
  readonly now?: () => Date
  /** How many recent decisions to surface. Default 5. */
  readonly recentDecisionsLimit?: number
}

/**
 * Short brand for each autonomy scope. Tiny but stable so the UI can rely on it.
 */
export const CAP_BRAND: Record<AutonomyScope, string> = {
  READ_ONLY: 'Read-only',
  SUGGEST: 'Suggest-only',
  EXECUTE_WITH_APPROVAL: 'Approval-gated',
  EXECUTE_AUTONOMOUSLY: 'Autonomous'
}
