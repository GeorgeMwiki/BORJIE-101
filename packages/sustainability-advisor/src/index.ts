/**
 * `@borjie/sustainability-advisor` — public surface.
 *
 * Veteran-expert ESG, carbon, and green-finance advisor for property
 * management. Composed of pure calculators (GHG Scope 1/2/3, embodied,
 * green-building rating estimators, EU Taxonomy alignment, BNG, SBTN,
 * NbS) and a single advisor module that assembles them into the
 * PropertyEsg report.
 */

// Types
export * from './types.js';

// GHG Protocol
export {
  computeScope1,
  FACTOR_VERSION,
  FUEL_FACTORS,
  REFRIGERANT_GWP100,
  type FuelInput,
  type FuelKey,
  type RefrigerantInput,
  type RefrigerantKey,
  type Scope1Inputs,
} from './ghg-scope/scope1-calc.js';
export {
  computeScope2,
  GRID_INTENSITY_KGCO2_PER_KWH,
  SCOPE2_VERSION,
  type Scope2Inputs,
} from './ghg-scope/scope2-calc.js';
export {
  computeScope3,
  SCOPE3_VERSION,
  TRAVEL_FACTORS_PER_PAX_KM,
  WASTE_FACTORS_PER_TONNE,
  type DownstreamLeasedAssetInput,
  type Scope3Inputs,
  type TravelInput,
  type TravelMode,
  type WasteInput,
  type WasteStream,
} from './ghg-scope/scope3-calc.js';
export {
  computeEmbodiedCarbon,
  MATERIAL_FACTORS,
  QUICK_INTENSITY_PER_M2,
  TRANSPORT_FACTORS_TKM,
  type EmbodiedInputs,
  type MaterialKey,
  type MaterialQuantity,
} from './ghg-scope/embodied-carbon-calc.js';

// Ratings
export {
  estimateBreeam,
  breeamBand,
  BREEAM_CATEGORY_WEIGHTS,
  BREEAM_VERSION,
  type BreeamInputs,
} from './ratings/breeam-estimator.js';
export {
  estimateLeedV5,
  leedBand,
  LEED_V5_WEIGHTS,
  LEED_VERSION,
  LEED_TOTAL_BASE,
  type LeedV5Inputs,
} from './ratings/leed-v5-estimator.js';
export {
  estimateGreenStar,
  greenStarBand,
  GREEN_STAR_VERSION,
  GREEN_STAR_WEIGHTS,
  type GreenStarInputs,
} from './ratings/green-star-estimator.js';
export {
  estimateEdge,
  EDGE_VERSION,
  type EdgeInputs,
} from './ratings/edge-estimator.js';
export {
  estimateEpc,
  ukEpcScore,
  ukBandFor,
  euBandFor,
  EPC_VERSION,
  EU_EPC_BANDS_KWH_PER_M2,
  UK_EPC_BANDS,
  type EpcInputs,
} from './ratings/epc-rating.js';

// Credits
export {
  valuateCarbonCredits,
  createStubCarbonPriceFeed,
  STUB_QUALITY_GRADES,
  STUB_SPOT_USD,
  type CarbonCreditValuationInputs,
} from './credits/carbon-credit-valuator.js';
export {
  assessEuTaxonomy,
  DNSH_WATER_MAX_L_PER_MIN,
  PRE_2021_REQUIRES_TOP_PCT,
  type EuTaxonomyInputs,
} from './credits/eu-taxonomy-alignment.js';

// Disclosures
export {
  renderTcfdNarrative,
  type TcfdInputs,
} from './disclosures/tcfd-renderer.js';
export {
  renderIfrsS2Pack,
  type IfrsS2Inputs,
} from './disclosures/ifrs-s2-renderer.js';
export {
  buildGresbInputPack,
  gresbRowFromCarbon,
  type AssetClassPerformanceInput,
  type GresbInputs,
} from './disclosures/gresb-input-builder.js';

// Biodiversity
export {
  computeBngAssessment,
  unitsForParcel,
  BNG_METRIC_VERSION,
  CONDITION_SCORE,
  DISTINCTIVENESS_SCORE,
  STATUTORY_CREDIT_GBP_PER_UNIT,
  STRATEGIC_SCORE,
  type BngInputs,
} from './biodiversity/bng-calculator.js';
export {
  suggestSbtnTargets,
  type SbtnInputs,
} from './biodiversity/sbtn-targets.js';
export {
  recommendNbs,
  DEFAULT_NBS_CATALOG,
  type NbsCatalogEntry,
  type NbsRecommenderInputs,
} from './biodiversity/nbs-recommender.js';

// Advisor
export {
  buildPropertyEsgReport,
  rollupCarbon,
  type PropertyEsgInputs,
} from './advisor/property-esg-report.js';
export {
  rollupPortfolio,
  type PortfolioBenchmarks,
  type PortfolioRollup,
} from './advisor/portfolio-rollup.js';

// Trading-desk bridge — optional wire to `@borjie/carbon-market`.
export {
  tradingDeskFor,
  type TradingDeskForOptions,
} from './advisor/trading-desk-bridge.js';
