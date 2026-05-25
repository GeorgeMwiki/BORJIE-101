/**
 * `@borjie/mining-commodity-intelligence` — public surface.
 */

export {
  createCommodityIntelligence,
  deriveRecommendations,
  type CommodityIntelligence,
  type CommodityIntelligenceDeps,
} from './commodity-intelligence.js';

export {
  intelInputSchema,
  intelSnapshotSchema,
  intelRecommendationSchema,
  intelRecommendationContextSchema,
  intelRecommendationKindSchema,
  priceTickSchema,
  priceHistorySchema,
  type IntelInput,
  type IntelSnapshot,
  type IntelRecommendation,
  type IntelRecommendationContext,
  type IntelRecommendationKind,
  type PriceTick,
  type PriceHistory,
  type TrendWindow,
  type TrendDirection,
  type Commodity,
  type CurrencyCode,
  type EvidenceRef,
} from './types.js';

export {
  NOOP_LOGGER,
  type Logger,
  type PriceSourceAdapter,
  type LmbmIntelPort,
} from './ports.js';

export {
  createLmeAdapter,
  LME_SOURCE_ID,
  type LmeAdapterConfig,
} from './adapters/lme.js';

export {
  createKitcoAdapter,
  KITCO_SOURCE_ID,
  type KitcoAdapterConfig,
} from './adapters/kitco.js';
