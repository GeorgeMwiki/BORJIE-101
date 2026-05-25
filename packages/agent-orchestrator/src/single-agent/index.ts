/**
 * Single-agent patterns barrel.
 */

export {
  runReAct,
  DEFAULT_REACT_MAX_STEPS,
  type RunReActInput,
} from './react.js';

export {
  runPlanAndExecute,
  DEFAULT_PLAN_EXECUTE_MAX_STEPS,
  type Planner,
  type Executor,
  type Composer,
  type RunPlanAndExecuteInput,
  type StepExecutionResult,
} from './plan-and-execute.js';

export {
  runReflexion,
  DEFAULT_REFLEXION_MAX_LOOPS,
  DEFAULT_REFLEXION_ACCEPT_THRESHOLD,
  type ReflexionRunner,
  type ReflexionEvaluator,
  type RunReflexionInput,
} from './reflexion.js';

export {
  runSelfConsistency,
  DEFAULT_SELF_CONSISTENCY_N,
  DEFAULT_SELF_CONSISTENCY_TEMPERATURE,
  type RunSelfConsistencyInput,
} from './self-consistency.js';

export {
  runConstitutionalCritique,
  type ConstitutionalCritiqueInput,
  type ConstitutionalCritiqueResult,
} from './constitutional-critique.js';
