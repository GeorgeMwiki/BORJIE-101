// Public surface of the decision-provenance module.

export type {
  EvidenceRef,
  AlternativeConsidered,
  DecisionEvent,
  IAppendOnlyDecisionStore,
  DecisionProvenanceDeps
} from './types.js'

export {
  recordDecision,
  getProvenance,
  validateDecisionEvent
} from './record-decision.js'
