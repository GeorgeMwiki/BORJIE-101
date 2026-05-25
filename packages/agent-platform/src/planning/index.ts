/**
 * Plan-and-Execute orchestration — public barrel.
 *
 * 2026 SOTA replacement for sequential ReAct loops:
 *   planner (multi-LLM) → DAG batcher → parallel workers → verifier
 *   (multi-LLM) → re-planner if confidence < threshold.
 *
 * 92% completion + 3.6× speedup vs sequential ReAct in cross-tool
 * benchmarks. See `.audit/litfin-sota-2026-05-23/15-cross-tool-stitching.md`.
 */

export * from './types.js';
export { validatePlanDag, type DagValidationError, type DagValidationResult } from './dag.js';
export { buildPlan, type PlannerError, type PlannerInput, type PlannerResult } from './planner.js';
export { verifyGoal } from './verifier.js';
export { rebuildPlan, type ReplannerInput } from './replanner.js';
export { runBatch, type RunBatchOptions } from './worker-runner.js';
export { InMemoryAuditSink, nextEntryId } from './audit-trail.js';
export {
  runPlanExecute,
  type RunPlanExecuteInput,
  type RunPlanExecuteResult,
} from './orchestrator.js';
