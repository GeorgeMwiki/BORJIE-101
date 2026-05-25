/**
 * Gatherer barrel — exports all 10 report-type gatherers + the shared
 * ports + the resolver that picks the right gatherer for a spec.type.
 */

import type { Gatherer, ReportType } from '../types.js';
import type { AdvisorPorts } from './ports.js';
import { createLeasingFinancialGatherer } from './leasing-financial.js';
import { createConditionalSurveyGatherer } from './conditional-survey.js';
import { createAcquisitionIcGatherer } from './acquisition-ic.js';
import { createDispositionGatherer } from './disposition.js';
import { createRefinancingGatherer } from './refinancing.js';
import { createSustainabilityGatherer } from './sustainability.js';
import { createExpansionStrategyGatherer } from './expansion-strategy.js';
import { createTenantCreditGatherer } from './tenant-credit.js';
import { createRentRollGatherer } from './rent-roll.js';
import { createAnnualOperatingReviewGatherer } from './annual-operating-review.js';

export {
  createLeasingFinancialGatherer,
  createConditionalSurveyGatherer,
  createAcquisitionIcGatherer,
  createDispositionGatherer,
  createRefinancingGatherer,
  createSustainabilityGatherer,
  createExpansionStrategyGatherer,
  createTenantCreditGatherer,
  createRentRollGatherer,
  createAnnualOperatingReviewGatherer,
};

export type {
  AdvisorPorts,
  AcquisitionAdvisorPort,
  AcquisitionDeal,
  ConditionalSurveyPort,
  DispositionThesis,
  ExpansionAdvisorPort,
  ExpansionRecommendation,
  GreenAngleAdvisorPort,
  GreenAngleSummary,
  LeasingFinancialPort,
  LifecycleAdvisorPort,
  MoneyAmount,
  OccupancyLine,
  RefinancingProposal,
  RentRollEntry,
  RentRollPort,
  RevenueLine,
  SurveyDefect,
  SurveySnapshot,
  SustainabilityAdvisorPort,
  SustainabilitySnapshot,
  TenantContextPort,
  TenantContextProfile,
} from './ports.js';

/**
 * Resolve a Gatherer factory for a report type. All gatherers share
 * the same `(ports) → Gatherer` shape so the renderer can pick one
 * generically. Adding a new report type requires (a) a new gatherer
 * file, (b) a new entry here, (c) a new composer in `../composers/`,
 * and (d) a new golden test.
 */
export function gathererFor(type: ReportType, ports: AdvisorPorts): Gatherer {
  switch (type) {
    case 'leasing_financial_performance':
      return createLeasingFinancialGatherer({ ports });
    case 'conditional_survey_of_assets':
      return createConditionalSurveyGatherer({ ports });
    case 'acquisition_deal_ic_memo':
      return createAcquisitionIcGatherer({ ports });
    case 'disposition_memo_asset_profile':
      return createDispositionGatherer({ ports });
    case 'refinancing_strategy_memo':
      return createRefinancingGatherer({ ports });
    case 'sustainability_ghg_report':
      return createSustainabilityGatherer({ ports });
    case 'expansion_strategy_memo':
      return createExpansionStrategyGatherer({ ports });
    case 'tenant_credit_risk_profile':
      return createTenantCreditGatherer({ ports });
    case 'rent_roll_arrears_ledger':
      return createRentRollGatherer({ ports });
    case 'annual_estate_operating_review':
      return createAnnualOperatingReviewGatherer({ ports });
  }
}
