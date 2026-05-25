/**
 * @borjie/extended-reasoning — Phase M-G public surface.
 *
 * The five patterns the L1 deep-reasoning audit explicitly deferred, each
 * grounded in a concrete BORJIE use case. See README.md and
 * `.research/l1-deep-reasoning-frontier-audit.md` (deferred-list at line 421)
 * for context.
 */

export * as got from './got/index.js';
export * as lats from './lats/index.js';
export * as tot from './tot/index.js';
export * as prmSubstrate from './prm-substrate/index.js';
export * as sot from './sot/index.js';

// Top-level convenience re-exports for the most common entry points
export { runGoT } from './got/index.js';
export { runLATS } from './lats/index.js';
export {
  runToT,
  runToTTree,
  EVICTION_DECISION_TREE,
  VENDOR_SELECTION_TREE,
  KRA_FILING_TREE,
  TENANT_SCREENING_TREE,
} from './tot/index.js';
export {
  scoreStepWithPRM,
  emitPrmTrainingSample,
  runPrmEval,
} from './prm-substrate/index.js';
export { runSoT } from './sot/index.js';

// Shared types — useful for downstream packages that wrap these primitives
export type { ModelAdapter, ModelInput, Outcome, StepScore } from './shared/types.js';
