/**
 * `@borjie/fx-treasury-advisor` — public surface.
 */

export {
  createFxTreasuryAdvisor,
  projectRunway,
  computeExposure,
  deriveRecommendations,
  type FxTreasuryAdvisor,
  type FxTreasuryAdvisorDeps,
} from './fx-treasury.js';

export {
  treasuryInputSchema,
  treasuryAnalysisSchema,
  treasuryRecommendationSchema,
  treasuryRecommendationContextSchema,
  treasuryRecommendationKindSchema,
  runwayProjectionSchema,
  fxExposureSchema,
  type TreasuryInput,
  type TreasuryAnalysis,
  type TreasuryRecommendation,
  type TreasuryRecommendationContext,
  type TreasuryRecommendationKind,
  type RunwayProjection,
  type RunwayPoint,
  type FxExposure,
  type ExposureRow,
  type CashBalance,
  type Cashflow,
  type Stockpile,
  type FxRate,
  type Money,
  type CurrencyCode,
  type EvidenceRef,
  type RecommendationSeverity,
} from './types.js';

export {
  NOOP_LOGGER,
  type Logger,
  type LmbmTreasuryPort,
  type FxRateFeedPort,
  type BrainPort,
} from './ports.js';
