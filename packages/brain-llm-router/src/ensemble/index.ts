/**
 * @borjie/brain-llm-router/ensemble — the all-at-once orchestrative ensemble
 * (run N models in parallel, combine per strategy). Cost-aware + fail-safe.
 */

export { runEnsemble } from './run-ensemble.js';
export type {
  EnsembleInvoke,
  EnsembleSynthesise,
  EnsembleBudgetCheck,
  EnsembleBudgetDecision,
  RunEnsembleArgs,
  RunEnsembleResult,
} from './run-ensemble.js';
