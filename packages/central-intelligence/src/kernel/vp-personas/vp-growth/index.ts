/**
 * VP Growth — public factory + barrel.
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
import { orchestrateGrowth, VP_GROWTH_LINE_WORKERS } from './orchestrate.js';
import { VP_GROWTH_PERSONA } from './persona.js';
import { draftGrowthWeeklyReport } from './report.js';

export function createVpGrowth(deps: VpDeps): VpDepartmentHead {
  return Object.freeze({
    name: 'vp.growth',
    persona: VP_GROWTH_PERSONA,
    reportsTo: 'owner' as const,
    lineWorkers: VP_GROWTH_LINE_WORKERS,

    async orchestrate(intent: OwnerIntent): Promise<VpOrchestrationPlan> {
      return orchestrateGrowth({ intent, catalogue: deps.lineWorkerCatalogue });
    },

    async draftWeeklyReport(args: {
      readonly scope: ScopeContext;
      readonly weekStartingIso: string;
      readonly rollups: ReadonlyArray<VpLineWorkerRollup>;
    }): Promise<VpWeeklyReport> {
      return draftGrowthWeeklyReport(args);
    },
  });
}

export { VP_GROWTH_PERSONA } from './persona.js';
export { VP_GROWTH_LINE_WORKERS, routeGrowthIntent } from './orchestrate.js';
export {
  VP_GROWTH_REPORT_CARDS,
  draftGrowthWeeklyReport,
  type VpGrowthReportCardKey,
} from './report.js';
