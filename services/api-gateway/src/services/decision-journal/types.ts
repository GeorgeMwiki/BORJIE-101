/**
 * Decision Journal — shared types.
 *
 * Three append-only, hash-chained tables back this service:
 *   decisions          chosen value + alternatives + rationale + scope
 *   decision_outcomes  retrospective grade written by the worker
 *   decision_links     supersedes / depends_on / informed_by / reversed_by
 *
 * No mutation, no I/O. Caller passes immutable values; the recorder
 * computes the chain hash and persists.
 */

export const DECIDED_BY_KINDS = [
  'owner',
  'brain',
  'agent_apply',
  'four_eye',
  'automated_policy',
] as const;
export type DecidedByKind = (typeof DECIDED_BY_KINDS)[number];

export const DECISION_STATUSES = [
  'committed',
  'rolled_back',
  'superseded',
] as const;
export type DecisionStatus = (typeof DECISION_STATUSES)[number];

export const RETROSPECTIVE_GRADES = [
  'good',
  'neutral',
  'bad',
  'undetermined',
] as const;
export type RetrospectiveGrade = (typeof RETROSPECTIVE_GRADES)[number];

export const OUTCOME_RECORDERS = ['reconciler', 'owner', 'brain'] as const;
export type OutcomeRecorder = (typeof OUTCOME_RECORDERS)[number];

export const DECISION_LINK_RELATIONSHIPS = [
  'supersedes',
  'depends_on',
  'informed_by',
  'reversed_by',
] as const;
export type DecisionLinkRelationship =
  (typeof DECISION_LINK_RELATIONSHIPS)[number];

export interface DecisionAlternative {
  readonly option: Readonly<Record<string, unknown>> | string;
  readonly whyNot: string;
}

export interface DecisionProvenance {
  readonly via?: 'chat' | 'ui_form' | 'four_eye' | 'cron' | 'agent' | 'api';
  readonly sessionId?: string | null;
  readonly turnId?: string | null;
  readonly personaSlug?: string | null;
  readonly toolId?: string | null;
  readonly [key: string]: unknown;
}

/**
 * Inputs accepted by `recordDecision`. `decidedAt` defaults to now()
 * when omitted; tests pass a deterministic ISO string.
 */
export interface RecordDecisionInput {
  readonly tenantId: string;
  readonly decidedByKind: DecidedByKind;
  readonly decidedByActorId: string;
  readonly decisionSubject: string;
  readonly decisionSubjectEntityKind?: string | null;
  readonly decisionSubjectEntityId?: string | null;
  readonly decidedValue: Readonly<Record<string, unknown>>;
  readonly alternativesConsidered?: ReadonlyArray<DecisionAlternative>;
  readonly rationale: string;
  readonly confidence?: number | null;
  readonly decidedAt?: string;
  readonly scopeIds?: ReadonlyArray<string>;
  readonly relatedPredictionId?: string | null;
  readonly relatedActionAuditHash?: string | null;
  readonly status?: DecisionStatus;
  readonly provenance?: DecisionProvenance;
}

/**
 * Decision row as returned by the recorder. Immutable.
 */
export interface RecordedDecision {
  readonly id: string;
  readonly tenantId: string;
  readonly decidedByKind: DecidedByKind;
  readonly decidedByActorId: string;
  readonly decisionSubject: string;
  readonly decisionSubjectEntityKind: string | null;
  readonly decisionSubjectEntityId: string | null;
  readonly decidedValue: Readonly<Record<string, unknown>>;
  readonly alternativesConsidered: ReadonlyArray<DecisionAlternative>;
  readonly rationale: string;
  readonly confidence: number | null;
  readonly decidedAt: string;
  readonly scopeIds: ReadonlyArray<string>;
  readonly relatedPredictionId: string | null;
  readonly relatedActionAuditHash: string | null;
  readonly status: DecisionStatus;
  readonly provenance: DecisionProvenance;
  readonly entryHash: string;
  readonly prevHash: string | null;
}

/**
 * Inputs accepted by `recordOutcome`.
 */
export interface RecordOutcomeInput {
  readonly tenantId: string;
  readonly decisionId: string;
  readonly outcomeSummary: string;
  readonly observedValueTzs?: number | null;
  readonly observedAt?: string;
  readonly retrospectiveGrade: RetrospectiveGrade;
  readonly learnings?: string | null;
  readonly recordedBy: OutcomeRecorder;
}

export interface RecordedOutcome {
  readonly id: string;
  readonly tenantId: string;
  readonly decisionId: string;
  readonly outcomeSummary: string;
  readonly observedValueTzs: number | null;
  readonly observedAt: string;
  readonly retrospectiveGrade: RetrospectiveGrade;
  readonly learnings: string | null;
  readonly recordedBy: OutcomeRecorder;
  readonly entryHash: string;
  readonly prevHash: string | null;
}

export interface RecordLinkInput {
  readonly tenantId: string;
  readonly sourceDecisionId: string;
  readonly targetDecisionId: string;
  readonly relationship: DecisionLinkRelationship;
  readonly note?: string | null;
}

export interface RecordedLink {
  readonly tenantId: string;
  readonly sourceDecisionId: string;
  readonly targetDecisionId: string;
  readonly relationship: DecisionLinkRelationship;
  readonly note: string | null;
  readonly entryHash: string;
  readonly prevHash: string | null;
}

/**
 * Error raised when an input fails validation. Carries a stable code
 * so the caller can branch on it without parsing the message.
 */
export class DecisionRecorderError extends Error {
  readonly code:
    | 'invalid_input'
    | 'persistence_failed'
    | 'unknown_decision';
  constructor(
    code:
      | 'invalid_input'
      | 'persistence_failed'
      | 'unknown_decision',
    message: string,
  ) {
    super(message);
    this.code = code;
    this.name = 'DecisionRecorderError';
  }
}
