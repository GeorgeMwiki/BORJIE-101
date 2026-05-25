/**
 * `@borjie/regulatory-tz-mining` — public surface.
 */

export {
  createRegulatoryTzAdvisor,
  deriveRecommendations,
  DEFAULT_RULES,
  type RegulatoryAdvisor,
  type RegulatoryAdvisorDeps,
} from './regulatory-tz.js';

export {
  regulatoryFactsSchema,
  regulatoryAnalysisSchema,
  regulatoryRecommendationSchema,
  regulatoryRecommendationContextSchema,
  ruleResultSchema,
  licenceSchema,
  eiaApprovalSchema,
  goldWindowReceiptSchema,
  taxFilingSchema,
  gepgControlNumberSchema,
  type RegulatoryFacts,
  type RegulatoryAnalysis,
  type RegulatoryRecommendation,
  type RegulatoryRecommendationContext,
  type RegulatoryRule,
  type RuleResult,
  type Regulator,
  type Verdict,
  type Licence,
  type LicenceKind,
  type EiaApproval,
  type GoldWindowReceipt,
  type TaxFiling,
  type GepgControlNumber,
  type EvidenceRef,
} from './types.js';

export { NEMC_RULES } from './rules/nemc.js';
export { TUMEMADINI_RULES } from './rules/tumemadini.js';
export { BOT_RULES } from './rules/bot.js';
export { TRA_RULES } from './rules/tra.js';
export { GEPG_RULES } from './rules/gepg.js';

export {
  NOOP_LOGGER,
  type Logger,
  type LmbmRegulatoryPort,
} from './ports.js';
