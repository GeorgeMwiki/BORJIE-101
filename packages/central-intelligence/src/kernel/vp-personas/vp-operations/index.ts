/**
 * VP Operations — public factory + barrel.
 *
 * VPs orchestrate line-workers; they do NOT have their own tool-belt.
 * The factory wires the catalogue + clock so the VP is testable
 * without a live event bus.
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
import { orchestrateOps, VP_OPERATIONS_LINE_WORKERS } from './orchestrate.js';
import { VP_OPERATIONS_PERSONA } from './persona.js';
import { draftOpsWeeklyReport } from './report.js';

export function createVpOperations(deps: VpDeps): VpDepartmentHead {
  return Object.freeze({
    name: 'vp.operations',
    persona: VP_OPERATIONS_PERSONA,
    reportsTo: 'owner' as const,
    lineWorkers: VP_OPERATIONS_LINE_WORKERS,

    async orchestrate(intent: OwnerIntent): Promise<VpOrchestrationPlan> {
      return orchestrateOps({ intent, catalogue: deps.lineWorkerCatalogue });
    },

    async draftWeeklyReport(args: {
      readonly scope: ScopeContext;
      readonly weekStartingIso: string;
      readonly rollups: ReadonlyArray<VpLineWorkerRollup>;
    }): Promise<VpWeeklyReport> {
      return draftOpsWeeklyReport(args);
    },
  });
}

export { VP_OPERATIONS_PERSONA } from './persona.js';
export { VP_OPERATIONS_LINE_WORKERS, routeOpsIntent } from './orchestrate.js';
export {
  VP_OPERATIONS_REPORT_CARDS,
  draftOpsWeeklyReport,
  type VpOperationsReportCardKey,
} from './report.js';
