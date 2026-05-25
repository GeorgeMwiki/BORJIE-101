/**
 * VP Finance — public factory + barrel.
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
import { orchestrateFinance, VP_FINANCE_LINE_WORKERS } from './orchestrate.js';
import { VP_FINANCE_PERSONA } from './persona.js';
import { draftFinanceWeeklyReport } from './report.js';

export function createVpFinance(deps: VpDeps): VpDepartmentHead {
  return Object.freeze({
    name: 'vp.finance',
    persona: VP_FINANCE_PERSONA,
    reportsTo: 'owner' as const,
    lineWorkers: VP_FINANCE_LINE_WORKERS,

    async orchestrate(intent: OwnerIntent): Promise<VpOrchestrationPlan> {
      return orchestrateFinance({ intent, catalogue: deps.lineWorkerCatalogue });
    },

    async draftWeeklyReport(args: {
      readonly scope: ScopeContext;
      readonly weekStartingIso: string;
      readonly rollups: ReadonlyArray<VpLineWorkerRollup>;
    }): Promise<VpWeeklyReport> {
      return draftFinanceWeeklyReport(args);
    },
  });
}

export { VP_FINANCE_PERSONA } from './persona.js';
export { VP_FINANCE_LINE_WORKERS, routeFinanceIntent } from './orchestrate.js';
export {
  VP_FINANCE_REPORT_CARDS,
  draftFinanceWeeklyReport,
  type VpFinanceReportCardKey,
} from './report.js';
