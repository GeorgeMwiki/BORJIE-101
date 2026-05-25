/**
 * `@borjie/capacity-expansion-advisor` — public surface.
 */

export {
  createCapacityExpansionAdvisor,
  scoreScenario,
  computeNpv,
  computeIrr,
  computePaybackYears,
  deriveRecommendations,
  type CapacityExpansionAdvisor,
  type CapacityExpansionAdvisorDeps,
} from './capacity-expansion.js';

export {
  expansionAnalyzeInputSchema,
  expansionAnalysisSchema,
  expansionScenarioInputSchema,
  expansionRecommendationSchema,
  expansionRecommendationContextSchema,
  scenarioOutcomeSchema,
  type ExpansionAnalyzeInput,
  type ExpansionAnalysis,
  type ExpansionScenarioInput,
  type ScenarioOutcome,
  type ExpansionRecommendation,
  type ExpansionRecommendationContext,
  type ExpansionKind,
  type Money,
  type CurrencyCode,
  type EvidenceRef,
} from './types.js';

export {
  NOOP_LOGGER,
  type Logger,
  type LmbmExpansionPort,
} from './ports.js';
