/**
 * Composer barrel — pairs a ReportType with its blueprint + the shared
 * `runComposer` driver.
 */

import type { BrainPort, Composer, ReportType, StrategicReport, ComposerContext } from '../types.js';
import { runComposer, type ComposerBlueprint } from './shared.js';
import {
  LEASING_FINANCIAL_BLUEPRINT,
  CONDITIONAL_SURVEY_BLUEPRINT,
  ACQUISITION_IC_BLUEPRINT,
  DISPOSITION_BLUEPRINT,
  REFINANCING_BLUEPRINT,
  SUSTAINABILITY_BLUEPRINT,
  EXPANSION_BLUEPRINT,
  TENANT_CREDIT_BLUEPRINT,
  RENT_ROLL_BLUEPRINT,
  AOR_BLUEPRINT,
} from './blueprints.js';

export {
  runComposer,
  type ComposerBlueprint,
  type SectionBlueprint,
  type RunComposerArgs,
  buildUserPrompt,
  parseSections,
  buildCitations,
} from './shared.js';

export {
  LEASING_FINANCIAL_BLUEPRINT,
  CONDITIONAL_SURVEY_BLUEPRINT,
  ACQUISITION_IC_BLUEPRINT,
  DISPOSITION_BLUEPRINT,
  REFINANCING_BLUEPRINT,
  SUSTAINABILITY_BLUEPRINT,
  EXPANSION_BLUEPRINT,
  TENANT_CREDIT_BLUEPRINT,
  RENT_ROLL_BLUEPRINT,
  AOR_BLUEPRINT,
};

export const BLUEPRINT_FOR: Readonly<Record<ReportType, ComposerBlueprint>> = Object.freeze({
  leasing_financial_performance: LEASING_FINANCIAL_BLUEPRINT,
  conditional_survey_of_assets: CONDITIONAL_SURVEY_BLUEPRINT,
  acquisition_deal_ic_memo: ACQUISITION_IC_BLUEPRINT,
  disposition_memo_asset_profile: DISPOSITION_BLUEPRINT,
  refinancing_strategy_memo: REFINANCING_BLUEPRINT,
  sustainability_ghg_report: SUSTAINABILITY_BLUEPRINT,
  expansion_strategy_memo: EXPANSION_BLUEPRINT,
  tenant_credit_risk_profile: TENANT_CREDIT_BLUEPRINT,
  rent_roll_arrears_ledger: RENT_ROLL_BLUEPRINT,
  annual_estate_operating_review: AOR_BLUEPRINT,
});

/**
 * Build a Composer that picks the right blueprint for `ctx.spec.type`.
 */
export function composerFor(brain: BrainPort): Composer {
  return async function compose(ctx: ComposerContext): Promise<StrategicReport> {
    const blueprint = BLUEPRINT_FOR[ctx.spec.type];
    return runComposer({ ctx, brain, blueprint });
  };
}
