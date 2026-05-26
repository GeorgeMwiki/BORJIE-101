/**
 * Junior registry — wires every executable junior name to its Zod input
 * schema + lazy default factory. Imported by `executor.ts`.
 *
 * Excluded by design (handled in `executor.ts`'s `NON_EXECUTABLE_JUNIORS`):
 *   - master-brain     — already invoked upstream; the dispatch_plan
 *                        originates from it.
 *   - auditor-agent    — runs over the COMBINED output, not synthesized
 *                        from raw chat text. Audit-pass phase concern.
 *   - document-agent   — needs an actual PDF buffer; synthesizing one
 *                        from a chat message is meaningless.
 */

import type { z, ZodSchema } from 'zod';

import { AssetFleetInputSchema, createDefaultAssetFleetAgent } from './asset-fleet-agent.js';
import { BuyerKycInputSchema, createDefaultBuyerKycAgent } from './buyer-kyc-agent.js';
import { CommunityInputSchema, createDefaultCommunityAgent } from './community-agent.js';
import { ComplianceInputSchema, createDefaultComplianceAgent } from './compliance-agent.js';
import {
  ContractCurrencyAuditorInputSchema,
  createDefaultContractCurrencyAuditor,
} from './contract-currency-auditor.js';
import { CostEngineerInputSchema, createDefaultCostEngineerAgent } from './cost-engineer.js';
import { DrillHoleInputSchema, createDefaultDrillHoleLogger } from './drill-hole-logger.js';
import { ForecastModelerInputSchema, createDefaultForecastModeler } from './forecast-modeler.js';
import { FxTreasuryInputSchema, createDefaultFxTreasuryAgent } from './fx-treasury-agent.js';
import { GeologyAgentInputSchema, createDefaultGeologyAgent } from './geology-agent.js';
import { HrAgentInputSchema, createDefaultHrAgent } from './hr-agent.js';
import { LabAssayInputSchema, createDefaultLabAssayAgent } from './lab-assay-agent.js';
import { LicenceAgentInputSchema, createDefaultLicenceAgent } from './licence-agent.js';
import { MaintenanceInputSchema, createDefaultMaintenanceAgent } from './maintenance-agent.js';
import {
  MarketingBrainMiningInputSchema,
  createDefaultMarketingBrainMiningAgent,
} from './marketing-brain-mining.js';
import {
  MarketplaceInputSchema,
  createDefaultMarketplaceStakeholderAgent,
} from './marketplace-stakeholder-agent.js';
import { MetallurgyInputSchema, createDefaultMetallurgyAgent } from './metallurgy-agent.js';
import { MinePlannerInputSchema, createDefaultMinePlanner } from './mine-planner.js';
import {
  NotificationsRouterInputSchema,
  createDefaultNotificationsRouter,
} from './notifications-router.js';
import { OperationsInputSchema, createDefaultOperationsSicAgent } from './operations-sic-agent.js';
import { ProcurementInputSchema, createDefaultProcurementAgent } from './procurement-agent.js';
import { ReportWriterInputSchema, createDefaultReportWriter } from './report-writer.js';
import { RiskModelerInputSchema, createDefaultRiskModeler } from './risk-modeler.js';
import { SafetyAgentInputSchema, createDefaultSafetyAgent } from './safety-agent.js';
import { SalesInputSchema, createDefaultSalesOfftakeAgent } from './sales-offtake-agent.js';
import {
  TutoringSkillPackMiningInputSchema,
  createDefaultTutoringSkillPackMiningAgent,
} from './tutoring-skill-pack-mining.js';
import { VillageCsrInputSchema, createDefaultVillageCsrAgent } from './village-csr-agent.js';

export interface JuniorAgent<TInput> {
  processInput(input: TInput): Promise<unknown>;
}

export interface JuniorEntry<TSchema extends ZodSchema> {
  readonly schema: TSchema;
  readonly factory: () => JuniorAgent<z.infer<TSchema>>;
}

function entry<TSchema extends ZodSchema>(
  schema: TSchema,
  factory: () => JuniorAgent<z.infer<TSchema>>,
): JuniorEntry<TSchema> {
  return { schema, factory };
}

export const JUNIOR_REGISTRY: Readonly<Record<string, JuniorEntry<ZodSchema>>> = {
  'asset-fleet-agent': entry(AssetFleetInputSchema, createDefaultAssetFleetAgent),
  'buyer-kyc-agent': entry(BuyerKycInputSchema, createDefaultBuyerKycAgent),
  'community-agent': entry(CommunityInputSchema, createDefaultCommunityAgent),
  'compliance-agent': entry(ComplianceInputSchema, createDefaultComplianceAgent),
  'contract-currency-auditor': entry(
    ContractCurrencyAuditorInputSchema,
    createDefaultContractCurrencyAuditor,
  ),
  'cost-engineer': entry(CostEngineerInputSchema, createDefaultCostEngineerAgent),
  'drill-hole-logger': entry(DrillHoleInputSchema, createDefaultDrillHoleLogger),
  'forecast-modeler': entry(ForecastModelerInputSchema, createDefaultForecastModeler),
  'fx-treasury-agent': entry(FxTreasuryInputSchema, createDefaultFxTreasuryAgent),
  'geology-agent': entry(GeologyAgentInputSchema, createDefaultGeologyAgent),
  'hr-agent': entry(HrAgentInputSchema, createDefaultHrAgent),
  'lab-assay-agent': entry(LabAssayInputSchema, createDefaultLabAssayAgent),
  'licence-agent': entry(LicenceAgentInputSchema, createDefaultLicenceAgent),
  'maintenance-agent': entry(MaintenanceInputSchema, createDefaultMaintenanceAgent),
  'marketing-brain-mining': entry(
    MarketingBrainMiningInputSchema,
    createDefaultMarketingBrainMiningAgent,
  ),
  'marketplace-stakeholder-agent': entry(
    MarketplaceInputSchema,
    createDefaultMarketplaceStakeholderAgent,
  ),
  'metallurgy-agent': entry(MetallurgyInputSchema, createDefaultMetallurgyAgent),
  'mine-planner': entry(MinePlannerInputSchema, createDefaultMinePlanner),
  'notifications-router': entry(
    NotificationsRouterInputSchema,
    createDefaultNotificationsRouter,
  ),
  'operations-sic-agent': entry(OperationsInputSchema, createDefaultOperationsSicAgent),
  'procurement-agent': entry(ProcurementInputSchema, createDefaultProcurementAgent),
  'report-writer': entry(ReportWriterInputSchema, createDefaultReportWriter),
  'risk-modeler': entry(RiskModelerInputSchema, createDefaultRiskModeler),
  'safety-agent': entry(SafetyAgentInputSchema, createDefaultSafetyAgent),
  'sales-offtake-agent': entry(SalesInputSchema, createDefaultSalesOfftakeAgent),
  'tutoring-skill-pack-mining': entry(
    TutoringSkillPackMiningInputSchema,
    createDefaultTutoringSkillPackMiningAgent,
  ),
  'village-csr-agent': entry(VillageCsrInputSchema, createDefaultVillageCsrAgent),
};

export const NON_EXECUTABLE_JUNIORS: ReadonlySet<string> = new Set([
  'master-brain',
  'auditor-agent',
  'document-agent',
]);
