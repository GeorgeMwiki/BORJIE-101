/**
 * Module 1 — plan-execute-split
 *
 * Opus 4.7 plans (read-only), Sonnet 4.7 executes. Public API surface.
 */

export * from './types.js';
export {
  createReadOnlyContext,
  runPlanPhase,
  isReadOnlyBashCommand,
  assertPlanPhaseToolAllowed,
} from './plan-phase.js';
export type { PlanPhaseFn } from './plan-phase.js';
export {
  createWriteContext,
  runExecutePhase,
  pathMatchesAllowedGlobs,
  globToRegex,
} from './execute-phase.js';
export type { ExecutorFn } from './execute-phase.js';
export { runSelfCodegenTask } from './run-self-codegen-task.js';
export type { SelfCodegenAdapters } from './run-self-codegen-task.js';
