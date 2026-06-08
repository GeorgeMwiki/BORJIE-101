/**
 * @borjie/autonomy-governance/decision — barrel.
 *
 * Continuous, per-decision autonomy controller (frontier replacement for
 * the 1-bit gated/auto switch). ADDITIVE overlay on the existing rails:
 * `composeWithRail` guarantees rail-gate always wins and the controller
 * may only escalate.
 */

export {
  decideAutonomy,
  moreCautious,
  isAtLeastAsCautious,
  DEFAULT_AUTO_CONFIDENCE_FLOORS,
} from './decide-autonomy.js';

export {
  composeWithRail,
  type RailOutcome,
  type ComposedAutonomyOutput,
} from './compose-with-rail.js';

export {
  calibratedConfidenceFromConformal,
  calibratedCoverageCeiling,
  type ConformalCoverageView,
} from './calibrated-confidence.js';

export type {
  AutonomyDecision,
  ConsequenceTier,
  Reversibility,
  DelegationMandate,
  SituationFlags,
  DecideAutonomyInput,
  DecideAutonomyOutput,
} from './types.js';
