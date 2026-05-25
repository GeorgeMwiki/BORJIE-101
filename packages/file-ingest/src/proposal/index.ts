export type { EntityMappingProposal, ProposalConflict } from './types.js';
export { entityMappingProposalSchema } from './types.js';
export {
  AUTO_MAP_THRESHOLD,
  LLM_PROPOSAL_THRESHOLD,
  routeByConfidence,
  type RoutingDecision,
} from './thresholds.js';
export { proposeMappingHeuristic } from './heuristic-map.js';
export type { HeuristicProposalInput } from './heuristic-map.js';
export {
  proposeMappingViaLlm,
  LlmProposalValidationError,
} from './llm-proposer.js';
export type { LlmProposerContext, LlmProposerFn } from './llm-proposer.js';
