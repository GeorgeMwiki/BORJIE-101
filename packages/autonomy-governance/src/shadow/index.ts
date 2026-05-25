/**
 * @borjie/autonomy-governance/shadow — barrel.
 *
 * Shadow-mode-then-convert cutover gate. Pure scoring + gate logic
 * (no persistence, no shadow-runner — those are downstream).
 *
 * See `cutover-gate.ts` for spec citations and `types.ts` for the data
 * contracts.
 */

export type {
  CutoverCriteria,
  CutoverCriterionResult,
  CutoverResult,
  DecisionKind,
  ShadowDecision,
  ShadowSession,
} from './types.js';
export { DEFAULT_CUTOVER_CRITERIA } from './types.js';

export {
  computeAgreementRate,
  countCriticalViolations,
  isEquivalent,
} from './agreement-scorer.js';

export {
  computeConfidenceCorrelation,
  pearson,
} from './calibration-scorer.js';

export { evaluate } from './cutover-gate.js';
