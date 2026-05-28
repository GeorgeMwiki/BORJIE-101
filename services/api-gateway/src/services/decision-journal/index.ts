/**
 * Decision Journal — service-level facade.
 *
 * Public surface used by:
 *   - the brain orchestrator (every WRITE tool that emits a structured
 *     `decision` payload — see middleware/wrap-tool-with-recorder.ts)
 *   - the four-eye approval flow (recording the approver's choice)
 *   - the owner-form submission handler (a routing decision from the
 *     owner directly)
 *   - the decision-retrospective worker (writes outcomes)
 *
 * The reader brain tools (decisions.recent / .explain / .search /
 * .replay / .what_did_i_decide / .success_rate) live in
 * services/api-gateway/src/composition/brain-tools/decision-journal-tools.ts.
 */

export {
  createDecisionRecorder,
  type DecisionRecorder,
  type DecisionRecorderDeps,
} from './recorder.js';

export {
  DECIDED_BY_KINDS,
  DECISION_STATUSES,
  RETROSPECTIVE_GRADES,
  OUTCOME_RECORDERS,
  DECISION_LINK_RELATIONSHIPS,
  DecisionRecorderError,
  type DecidedByKind,
  type DecisionStatus,
  type RetrospectiveGrade,
  type OutcomeRecorder,
  type DecisionLinkRelationship,
  type DecisionAlternative,
  type DecisionProvenance,
  type RecordDecisionInput,
  type RecordedDecision,
  type RecordOutcomeInput,
  type RecordedOutcome,
  type RecordLinkInput,
  type RecordedLink,
} from './types.js';

export {
  extractDecisionFraming,
  wrapBrainToolWithDecisionRecorder,
  type WrapWithRecorderDeps,
} from './middleware.js';
