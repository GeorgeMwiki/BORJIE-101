/**
 * `@borjie/cost-engineer-advisor` — public surface.
 */

export {
  createCostEngineerAdvisor,
  computeAnalysis,
  deriveRecommendations,
  type CostEngineerAdvisor,
  type CostEngineerAdvisorDeps,
} from './cost-engineer.js';

export {
  costAnalyzeInputSchema,
  costAnalysisSchema,
  pnlSchema,
  unitEconomicsSchema,
  sensitivitySchema,
  recommendationSchema,
  recommendationContextSchema,
  recommendationSeveritySchema,
  type CostAnalyzeInput,
  type CostAnalysis,
  type Pnl,
  type PnlLine,
  type UnitEconomics,
  type Sensitivity,
  type SensitivityRow,
  type Recommendation,
  type RecommendationContext,
  type RecommendationSeverity,
  type EvidenceRef,
  type Money,
  type CurrencyCode,
  type OpexBucket,
  type ProductionPeriod,
  type CogsContext,
} from './types.js';

export {
  NOOP_LOGGER,
  type Logger,
  type BrainPort,
  type LmbmReadPort,
  type LmbmWritePort,
} from './ports.js';
