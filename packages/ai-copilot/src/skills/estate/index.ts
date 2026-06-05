/**
 * Estate skills bundle — valuation, scoring, forecasting, advisory.
 *
 * Plug into the global skill registry via registerEstateSkills(dispatcher).
 */

import { ToolHandler } from '../../orchestrator/tool-dispatcher.js';
import { assetValuationTool } from './asset-valuation.js';
import { tenderBidScoringTool } from './tender-bid-scoring.js';
import { productionCapacityForecastTool } from './production-capacity-forecast.js';
import { royaltyRollAnalysisTool } from './royalty-roll-analysis.js';
import { buyerHealthCheckTool } from './buyer-health-check.js';
import { maintenanceCostForecastTool } from './maintenance-cost-forecast.js';
import { royaltyRepricingAdvisorTool } from './royalty-repricing-advisor.js';
import { buyerCreditTool } from './buyer-credit.js';
import { gradeAssetTool } from './asset-grading.js';

export * from './asset-valuation.js';
export * from './tender-bid-scoring.js';
export * from './production-capacity-forecast.js';
export * from './royalty-roll-analysis.js';
export * from './buyer-health-check.js';
export * from './maintenance-cost-forecast.js';
export * from './royalty-repricing-advisor.js';
export * from './buyer-credit.js';
export * from './asset-grading.js';

export const ESTATE_SKILL_TOOLS: readonly ToolHandler[] = [
  assetValuationTool,
  tenderBidScoringTool,
  productionCapacityForecastTool,
  royaltyRollAnalysisTool,
  buyerHealthCheckTool,
  maintenanceCostForecastTool,
  royaltyRepricingAdvisorTool,
  buyerCreditTool,
  gradeAssetTool,
];
