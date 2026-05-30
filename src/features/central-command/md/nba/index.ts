/**
 * Public surface for the NBA (Next-Best-Action) engine.
 *
 * Other features should depend on this module, not on internal files.
 *
 * @module features/central-command/md/nba
 */

export type {
  ActionCandidate,
  ActionDomain,
  ActionTemplate,
  ActionTrigger,
  ActionTriggerKind,
  BusinessSnapshot,
  ComplianceSignal,
  CustomerSignal,
  EisenhowerQuadrant,
  EisenhowerScore,
  EmployeeSignal,
  FinanceSignal,
  IceScore,
  LearningSignal,
  NbaServicePort,
  OwnerSentiment,
  OwnerStyle,
  PipelineSignal,
  RankedAction,
  RankingStrategy,
  RiceScore,
  SupplierSignal,
  WsjfScore,
} from "./types";

export {
  ACTION_CATALOG,
  ACTION_CATALOG_BY_DOMAIN,
  ACTION_CATALOG_SIZE,
  getActionTemplate,
} from "./action-catalog";

export { clamp, computeIce, round, scoreIce } from "./ice-scorer";
export { computeRice, scoreRice } from "./rice-scorer";
export { computeWsjf, scoreWsjf } from "./wsjf-scorer";
export {
  EISENHOWER_THRESHOLDS,
  classifyByScores,
  classifyEisenhower,
} from "./eisenhower";

export { generateCandidates } from "./candidate-generator";
export { dedupeRankings, rankCandidates } from "./context-aware-ranker";
export {
  LOW_HANGING_FRUIT_THRESHOLDS,
  findLowHangingFruit,
} from "./low-hanging-fruit-finder";
export { HIGH_IMPACT_THRESHOLD, findHighImpact } from "./high-impact-finder";

export { businessSnapshotSchema } from "./schemas";
export { NbaService, nbaService } from "./nba-service";
