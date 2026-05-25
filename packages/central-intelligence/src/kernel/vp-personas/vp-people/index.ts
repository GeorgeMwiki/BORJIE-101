/**
 * VP People — public factory + barrel.
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
import { orchestratePeople, VP_PEOPLE_LINE_WORKERS } from './orchestrate.js';
import { VP_PEOPLE_PERSONA } from './persona.js';
import { draftPeopleWeeklyReport } from './report.js';

export function createVpPeople(deps: VpDeps): VpDepartmentHead {
  return Object.freeze({
    name: 'vp.people',
    persona: VP_PEOPLE_PERSONA,
    reportsTo: 'owner' as const,
    lineWorkers: VP_PEOPLE_LINE_WORKERS,

    async orchestrate(intent: OwnerIntent): Promise<VpOrchestrationPlan> {
      return orchestratePeople({ intent, catalogue: deps.lineWorkerCatalogue });
    },

    async draftWeeklyReport(args: {
      readonly scope: ScopeContext;
      readonly weekStartingIso: string;
      readonly rollups: ReadonlyArray<VpLineWorkerRollup>;
    }): Promise<VpWeeklyReport> {
      return draftPeopleWeeklyReport(args);
    },
  });
}

export { VP_PEOPLE_PERSONA } from './persona.js';
export { VP_PEOPLE_LINE_WORKERS, routePeopleIntent } from './orchestrate.js';
export {
  VP_PEOPLE_REPORT_CARDS,
  draftPeopleWeeklyReport,
  type VpPeopleReportCardKey,
} from './report.js';
