/**
 * `@borjie/buyer-marketplace-advisor` — public surface.
 *
 * Wraps `@borjie/mining-commodity-intelligence` (mine catalog),
 * `@borjie/compliance-pack` (KYC), `@borjie/fx-treasury-advisor`
 * (payment terms + FX), and `@borjie/geo-intelligence` (route + ETA).
 */

export {
  createBuyerMarketplaceAdvisor,
  type BuyerMarketplaceAdvisor,
  type BuyerMarketplaceAdvisorDeps,
} from './advisor.js';

export { rankMines } from './recommend-mines.js';
export { scoreKyc } from './kyc-risk.js';
export { proposeTerms, buildHedgeLadder } from './payment-terms.js';
export { estimateEtaFor } from './eta-estimate.js';

export {
  buyerNeedSchema,
  mineProfileSchema,
  mineRecommendationSchema,
  kycFactSchema,
  kycRiskReportSchema,
  paymentTermProposalInputSchema,
  paymentTermProposalSchema,
  etaEstimateInputSchema,
  etaEstimateSchema,
  commoditySchema,
  currencyCodeSchema,
  riskBandSchema,
  paymentInstrumentSchema,
  fxHedgeRungSchema,
  type BuyerNeed,
  type Commodity,
  type CurrencyCode,
  type EtaEstimate,
  type EtaEstimateInput,
  type FxHedgeRung,
  type KycFact,
  type KycRiskReport,
  type LngLat,
  type MineProfile,
  type MineRecommendation,
  type PaymentInstrument,
  type PaymentTermProposal,
  type PaymentTermProposalInput,
  type RiskBand,
} from './types.js';

export {
  BuyerAdvisorError,
  UnknownBuyerError,
  KycBlockedError,
  RouteUnavailableError,
  type BuyerAdvisorErrorCode,
} from './errors.js';

export {
  NOOP_LOGGER,
  createInMemoryMineCatalog,
  createInMemoryKycSource,
  createInMemoryLogistics,
  type Logger,
  type MineCatalogPort,
  type KycSourcePort,
  type LogisticsPort,
  type InMemoryRouteEntry,
} from './ports.js';
