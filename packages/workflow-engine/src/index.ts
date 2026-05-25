/**
 * `@borjie/workflow-engine` — public barrel.
 *
 * Headline factory:
 *   createWorkflowEngine({
 *     scopeGuard, aiReviewer, approvalRouter, committer,
 *     definitionRegistry, runRepository, eventRepository,
 *     auditChainRepository, auditChain,
 *   })
 *
 * Engine state machine:
 *   start → propose-change → submit-for-review → (AI review) →
 *     human approval (when required) → commit | reject | cancel
 *
 * Every transition writes an append-only WorkflowRunEvent + one
 * hashed entry to the per-tenant audit chain.
 */

export * from './types.js';
export {
  BUILT_IN_WORKFLOW_DEFINITIONS,
  createDefinitionRegistry,
  findDefinitionById,
  listBuiltInDefinitions,
  type DefinitionRegistry,
} from './definitions/index.js';
export {
  computeDiff,
} from './deltas/index.js';
export {
  createWorkflowEngine,
  createInMemoryAuditChainRepository,
  createInMemoryRunEventRepository,
  createInMemoryRunRepository,
  type ApproveInput,
  type CancelInput,
  type CoachInput,
  type ProposeChangeInput,
  type RejectInput,
  type StartRunInput,
  type SubmitForReviewInput,
  type WorkflowEngine,
  type WorkflowEngineDeps,
} from './runs/index.js';
export {
  createAuditHashChain,
  verifyChainForRun,
  type AuditHashChain,
} from './audit/index.js';
export {
  createCommitter,
  createRecordingApplier,
  type ChangeApplier,
  type ChangeApplyOutcome,
  type Committer,
} from './commit/index.js';
export { type AIReviewerPort } from './review/index.js';
export {
  createInMemoryApprovalRouter,
  type ApprovalRouterDecision,
  type ApprovalRouterPort,
  type ElasticThresholds,
  type InMemoryApprovalRouterDeps,
} from './approval/index.js';
