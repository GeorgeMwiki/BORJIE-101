/**
 * `@borjie/learning-signal-emitter` — shared types.
 *
 * A captured action + a measured outcome together yield a LearningSignal:
 * the unified plumbing the brain uses to update every downstream learning
 * primitive in lock-step. Re-skinned from LITFIN learning/types.ts to the
 * Borjie mining-estate domain (org → tenant, borrower → owner/worker; NO
 * lending / PD / credit outcome dimensions).
 *
 * Per CLAUDE.md hard rules:
 *   - belief writes route through the belief sink (convince-loop) only;
 *     the emitter NEVER writes a belief directly.
 *   - tenant scope is enforced by the per-tier isolation gate before any
 *     persistence layer.
 */

export type ActionKind =
  | 'decide'
  | 'approve'
  | 'reject'
  | 'schedule'
  | 'dispatch'
  | 'chat'
  | 'nudge'
  | 'report'
  | 'appraisal'
  | 'other';

export type TenantScope = 'user' | 'org' | 'platform';

/** An action captured by the action-data layer. Minimal surface. */
export interface ActionEvent {
  readonly id: string;
  readonly kind: ActionKind;
  readonly capturedAt: string;
  readonly tenantOrgId?: string | null;
  readonly tenantUserId?: string | null;
  readonly actorId: string;
  readonly actorTier: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly decisionTraceId?: string | null;
}

/**
 * An outcome observation — measured (SLA hit, complaint filed) or inferred
 * (override detected). Mining-domain re-skin: managerOverride (a manager
 * flips a decision), ownerComplaint (the estate owner pushes back),
 * regulatorFinding (a mining regulator flags it).
 */
export interface OutcomeEvent {
  readonly id: string;
  readonly actionRef: string;
  readonly observedAt: string;
  readonly slaHit?: boolean;
  readonly slaDelaySeconds?: number;
  readonly managerOverride?: boolean;
  readonly ownerComplaint?: boolean;
  readonly regulatorFinding?: boolean;
  readonly costTzs?: number;
  readonly budgetTzs?: number;
  /** [-1, 1] explicit satisfaction (thumbs / NPS). */
  readonly explicitSatisfaction?: number;
}

export interface RewardComponents {
  readonly sla: number;
  readonly override: number;
  readonly complaint: number;
  readonly regulator: number;
  readonly cost: number;
  readonly satisfaction: number;
}

export type RewardWeights = RewardComponents;

export interface ScoredAction {
  readonly reward: number;
  readonly components: RewardComponents;
  readonly weights: RewardWeights;
}

/**
 * The single unit the brain emits per (action, outcome) pair. The emitter
 * routes it to belief / reflexion / mastery / pattern / preference sinks.
 */
export interface LearningSignal {
  readonly signalHash: string;
  readonly actionRef: string;
  readonly actionKind: ActionKind;
  readonly outcomeRef?: string;
  readonly reward: number;
  readonly components: RewardComponents;
  readonly tenantScope: TenantScope;
  readonly subjectUserId?: string | null;
  readonly subjectOrgId?: string | null;
  readonly emittedBy: string;
  readonly decisionTraceId?: string | null;
  readonly capturedAt: string;
}

export type SignalRoute =
  | 'belief-store'
  | 'reflexion-lessons'
  | 'mastery-tracker'
  | 'pattern-store'
  | 'persona-prompt-bridge'
  | 'preference-learner'
  | 'isolation-blocked'
  | 'no-route';

export interface EmissionResult {
  readonly signal: LearningSignal;
  readonly routedTo: ReadonlyArray<SignalRoute>;
  readonly notes: ReadonlyArray<string>;
}
