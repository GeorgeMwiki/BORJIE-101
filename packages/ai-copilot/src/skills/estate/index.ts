/**
 * Estate skills bundle — valuation, scoring, forecasting, advisory.
 *
 * Plug into the global skill registry via registerEstateSkills(dispatcher).
 */

import { ToolHandler } from '../../orchestrator/tool-dispatcher.js';
import { propertyValuationTool } from './property-valuation.js';
import { tenderBidScoringTool } from './tender-bid-scoring.js';
import { occupancyForecastTool } from './occupancy-forecast.js';
import { rentRollAnalysisTool } from './rent-roll-analysis.js';
import { tenantHealthCheckTool } from './tenant-health-check.js';
import { maintenanceCostForecastTool } from './maintenance-cost-forecast.js';
import { rentRepricingAdvisorTool } from './rent-repricing-advisor.js';
import { tenantCreditTool } from './tenant-credit.js';
import { gradePropertyTool } from './property-grading.js';

export * from './property-valuation.js';
export * from './tender-bid-scoring.js';
export * from './occupancy-forecast.js';
export * from './rent-roll-analysis.js';
export * from './tenant-health-check.js';
export * from './maintenance-cost-forecast.js';
export * from './rent-repricing-advisor.js';
export * from './tenant-credit.js';
export * from './property-grading.js';

export const ESTATE_SKILL_TOOLS: readonly ToolHandler[] = [
  propertyValuationTool,
  tenderBidScoringTool,
  occupancyForecastTool,
  rentRollAnalysisTool,
  tenantHealthCheckTool,
  maintenanceCostForecastTool,
  rentRepricingAdvisorTool,
  tenantCreditTool,
  gradePropertyTool,
];
