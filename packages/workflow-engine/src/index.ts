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
// Drizzle-backed repository adapters — selected by the composition root
// when a DatabaseClient is present so workflow runs / the four-eyes
// approval queue / the hashed audit chain survive an api-gateway restart.
export {
  createDrizzleRunRepository,
  createDrizzleRunEventRepository,
  createDrizzleAuditChainRepository,
  createDrizzleFlowAutonomyRepository,
} from './repositories/index.js';
// Flow-keyed autonomy — per-flow `auto | gated` posture + creation-time
// auto-vs-gated confirmation (migration 0308). The engine reads this seam
// to skip (AUTO) or block (GATED, default) the per-run human-approval
// step; the inviolable rails + autonomy-controller STILL gate per action.
export {
  FLOW_AUTONOMY_POSTURES,
  FLOW_CONFIRMATION_STATES,
  isFlowAuto,
  createInMemoryFlowAutonomyRepository,
  type FlowAutonomyPosture,
  type FlowConfirmationState,
  type FlowAutonomyPref,
  type FlowAutonomyRepository,
  type RecordFlowCreationInput,
  type SetFlowPostureInput,
} from './autonomy/index.js';
