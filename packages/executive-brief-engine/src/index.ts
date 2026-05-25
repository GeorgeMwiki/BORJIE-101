/**
 * @borjie/executive-brief-engine — Piece C public surface.
 *
 * The MD-level executive brief engine. Daily / weekly / monthly /
 * on-demand briefs structured as {gaps, opportunities, risks,
 * recommended_actions, citations}. Every claim is cited.
 *
 * Sub-modules:
 *
 *   types               — Zod schemas + TS types
 *   sensors             — sensor port interfaces + bundle gather
 *   retrieval           — hybrid retrieval (BM25 + vector + graph + MMR)
 *   hypothesis-generator — Haiku candidate synthesis
 *   hypothesis-verifier  — judge + ToT/LATS verification + citation
 *   debate              — three-voice debate for HIGH stakes
 *   action-emitter      — Piece B routing → RecommendedAction
 *   brief-assembler     — Zod-validate + hash-chain
 *   orchestrator        — top-level glue (`generateBrief`)
 *   cost-budget         — per-tenant daily cap
 */

export {
  ApprovalPacketSchema,
  BriefScopeSchema,
  CitationSchema,
  ExecutiveBriefSchema,
  FindingSchema,
  GapSchema,
  HypothesisSchema,
  OpportunitySchema,
  RecommendedActionSchema,
  RiskSchema,
  SeveritySchema,
  SEVERITY_LEVELS,
} from './types.js';

export type {
  ApprovalPacket,
  BriefScope,
  Citation,
  ExecutiveBrief,
  Finding,
  Gap,
  Hypothesis,
  Opportunity,
  RecommendedAction,
  Risk,
  Severity,
} from './types.js';

export {
  gatherSignals,
  groupSignalsBySensor,
  SensorSignalSchema,
} from './sensors.js';

export type {
  ArrearsSensorPort,
  AuditAnomaliesSensorPort,
  ComplaintsSensorPort,
  ContractsSensorPort,
  GatherArgs,
  KpiSensorPort,
  LedgerSensorPort,
  SensorBundle,
  SensorSignal,
  SensorSweepResult,
} from './sensors.js';

export { hybridRetrieve } from './retrieval.js';
export type {
  Bm25RetrieverPort,
  EmbedderPort,
  HybridRetrievalArgs,
  HybridRetrieverDeps,
  MmrRerankerPort,
  RetrievalHit,
  VectorRetrieverPort,
} from './retrieval.js';

export {
  generateHypotheses,
  parseHypothesisJson,
  HYPOTHESIS_PROMPT_VERSION,
} from './hypothesis-generator.js';
export type {
  GenerateArgs,
  GenerateResult,
  HaikuLlmPort,
} from './hypothesis-generator.js';

export { verifyHypotheses } from './hypothesis-verifier.js';
export type {
  OnlineJudgePort,
  ToTLatsPort,
  VerifiedHypothesis,
  VerifierArgs,
  VerifierDeps,
  VerifierResult,
} from './hypothesis-verifier.js';

export { runStakesAwareDebateOnBrief } from './debate.js';
export type {
  DebateArgs,
  DebatePort,
  DebateResult,
  DebatedHypothesis,
} from './debate.js';

export { emitRecommendedActions } from './action-emitter.js';
export type {
  EmitActionsArgs,
  EmitActionsResult,
  RoutingRulesPort,
} from './action-emitter.js';

export {
  assembleBrief,
  canonicalJson,
  computeHash,
  verifyBriefHash,
} from './brief-assembler.js';
export type { AssembleArgs } from './brief-assembler.js';

export {
  generateBrief,
  ENGINE_VERSION,
} from './orchestrator.js';
export type {
  AuditChainPort,
  GenerateBriefArgs,
  GenerateBriefResult,
  KillswitchHaltPort,
  OrchestratorDeps,
  PriorBriefLookupPort,
} from './orchestrator.js';

export {
  createInMemoryCostBudget,
} from './cost-budget.js';
export type {
  CostBudgetPort,
  InMemoryBudgetState,
} from './cost-budget.js';
