/**
 * VP Risk & Compliance — public factory + barrel.
 */

import type {
  OwnerIntent,
  VpDeps,
  VpDepartmentHead,
  VpLineWorkerRollup,
  VpOrchestrationPlan,
  VpWeeklyReport,
} from '../shared/vp-base.js';
import type { ScopeContext } from '../../../types.js';
import {
  orchestrateRiskCompliance,
  VP_RISK_COMPLIANCE_LINE_WORKERS,
} from './orchestrate.js';
import { VP_RISK_COMPLIANCE_PERSONA } from './persona.js';
import { draftRiskComplianceWeeklyReport } from './report.js';

export function createVpRiskCompliance(deps: VpDeps): VpDepartmentHead {
  return Object.freeze({
    name: 'vp.risk-compliance',
    persona: VP_RISK_COMPLIANCE_PERSONA,
    reportsTo: 'owner' as const,
    lineWorkers: VP_RISK_COMPLIANCE_LINE_WORKERS,

    async orchestrate(intent: OwnerIntent): Promise<VpOrchestrationPlan> {
      return orchestrateRiskCompliance({ intent, catalogue: deps.lineWorkerCatalogue });
    },

    async draftWeeklyReport(args: {
      readonly scope: ScopeContext;
      readonly weekStartingIso: string;
      readonly rollups: ReadonlyArray<VpLineWorkerRollup>;
    }): Promise<VpWeeklyReport> {
      return draftRiskComplianceWeeklyReport(args);
    },
  });
}

export { VP_RISK_COMPLIANCE_PERSONA } from './persona.js';
export {
  VP_RISK_COMPLIANCE_LINE_WORKERS,
  routeRiskComplianceIntent,
} from './orchestrate.js';
export {
  VP_RISK_COMPLIANCE_REPORT_CARDS,
  draftRiskComplianceWeeklyReport,
  type VpRiskComplianceReportCardKey,
} from './report.js';
