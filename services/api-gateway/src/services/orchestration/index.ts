/**
 * Orchestration — CE-2 multi-turn plan-DAG runner.
 *
 * Exports:
 *
 *   - PlanDag / PlanStep / PlanEdge   data model (zod-validated)
 *   - validatePlanEdges, topologicalOrder, applyRiskTierPolicy
 *   - runPlan, DispatchToolFn, ConfirmCheckpointFn
 *   - TOP_FLOWS                       5 named multi-step flows
 *   - resolveRiskTier, summariseRiskTiers
 *
 * Consumer: brain-teach SSE route renders `<plan_preview>` from a
 * PlanDag; an upcoming "run plan" endpoint accepts a planId and
 * invokes `runPlan`. Both wiring tasks are out-of-scope for this
 * wave — this module ships the kernel only.
 */

export {
  type HumanCheckpoint,
  type PlanDag,
  type PlanEdge,
  type PlanRunSnapshot,
  type PlanStep,
  type PlanStepState,
  type RiskTier,
  applyRiskTierPolicy,
  humanCheckpointSchema,
  planDagSchema,
  planEdgeSchema,
  planStepSchema,
  planStepStateSchema,
  riskTierSchema,
  topologicalOrder,
  validatePlanEdges,
} from './plan-dag';

export {
  type ConfirmCheckpointArgs,
  type ConfirmCheckpointFn,
  type ConfirmCheckpointResult,
  type DispatchToolArgs,
  type DispatchToolFn,
  type DispatchToolResult,
  type RunPlanOptions,
  runPlan,
} from './plan-runner';

export {
  type DispatchRfbChainIntent,
  type DraftSignAndSendLoiIntent,
  type IncidentToBuyerIntent,
  type LicenceRenewalIntent,
  type SettleCoopIntent,
  type TopFlowName,
  TOP_FLOWS,
  dispatchRfbToManagerChain,
  draftSignAndSendLoi,
  incidentToReportToBuyer,
  licenceRenewalChain,
  settleAndPayoutCoop,
} from './top-flows';

export { resolveRiskTier, summariseRiskTiers } from './risk-tiers';

// CE-6 — inline block kind selector.
export {
  type BlockHintContext,
  type InlineBlockKind,
  inlineBlockKindSchema,
  selectInlineBlock,
} from './block-selector';

// CE-7 — grounding helpers (evidence-required invariant).
export {
  type EvidenceChainProblem,
  type EvidenceClaim,
  attachEvidenceToPlan,
  evidenceClaimSchema,
  summariseEvidenceCoverage,
  validateEvidenceChain,
} from './grounding';
