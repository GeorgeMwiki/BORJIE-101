/**
 * maintenance.dispatch — public API for the Tier-A sub-MD.
 *
 * Evidence: cross-vendor 45% emergency-response reduction, 15-20%
 * spend reduction, 89-96% classification accuracy. No documented
 * major failure modes (per R3 evidence audit).
 */

import { createOutcomeRecorder, type OutcomeRecorder } from '../shared/outcome-recorder.js';
import type {
  ActualOutcome,
  AutomationArtifact,
  ObservedEvent,
  PredictedOutcome,
  ProcessGraph,
  RedesignProposal,
  ScopeFilter,
  SubMd,
  SubMdContext,
} from '../shared/sub-md-base.js';
import { automateMaintenance } from './automate.js';
import { mapMaintenance } from './map.js';
import { observeMaintenance } from './observe.js';
import { MAINTENANCE_DISPATCHER_PERSONA } from './persona.js';
import { redesignMaintenance } from './redesign.js';

export const MAINTENANCE_DISPATCH_NAME = 'maintenance.dispatch';

export const MAINTENANCE_DISPATCH_TOOLS = Object.freeze([
  'maintenance.classify_ticket',
  'maintenance.pick_vendor',
  'maintenance.dispatch_work_order',
  'maintenance.follow_up',
] as const);

export interface MaintenanceDispatchSubMdArgs {
  readonly scope: ScopeFilter;
  readonly recorder?: OutcomeRecorder;
}

export function createMaintenanceDispatchSubMd(
  args: MaintenanceDispatchSubMdArgs,
): SubMd {
  const recorder = args.recorder ?? createOutcomeRecorder();

  return Object.freeze({
    name: MAINTENANCE_DISPATCH_NAME,
    persona: MAINTENANCE_DISPATCHER_PERSONA,
    scope: args.scope,
    toolBelt: MAINTENANCE_DISPATCH_TOOLS,
    riskTier: 'mutate',

    observe(ctx: SubMdContext): AsyncIterable<ObservedEvent> {
      return {
        [Symbol.asyncIterator]: async function* () {
          const collected = await observeMaintenance(ctx);
          for (const evt of collected) yield evt;
        },
      };
    },

    async map(
      events: ReadonlyArray<ObservedEvent>,
      _ctx: SubMdContext,
    ): Promise<ProcessGraph> {
      return mapMaintenance(events);
    },

    async redesign(
      graph: ProcessGraph,
      ctx: SubMdContext,
    ): Promise<RedesignProposal> {
      return redesignMaintenance(graph, ctx);
    },

    async automate(
      proposal: RedesignProposal,
      ctx: SubMdContext,
    ): Promise<AutomationArtifact> {
      return automateMaintenance(proposal, ctx.budget);
    },

    async recordOutcome(actual: ActualOutcome, predicted: PredictedOutcome): Promise<void> {
      await recorder.record({
        subMdName: MAINTENANCE_DISPATCH_NAME,
        predicted,
        actual,
      });
    },
  });
}

export { classifyTicket } from './tools/classify-ticket.js';
export type {
  ClassifiedTicket,
  TicketCategory,
  TicketUrgency,
} from './tools/classify-ticket.js';
export { pickVendor } from './tools/pick-vendor.js';
export type {
  PickVendorArgs,
  PickVendorResult,
  VendorPick,
  VendorRecord,
} from './tools/pick-vendor.js';
export { dispatchWorkOrder, recallWorkOrder } from './tools/dispatch.js';
export type {
  DispatchArgs,
  DispatchAuditSink,
  DispatchResult,
  DispatchTransportPort,
  VendorChannel,
  WorkOrderDraft,
} from './tools/dispatch.js';
export { followUp } from './tools/follow-up.js';
export type {
  FollowUpArgs,
  FollowUpDraft,
  FollowUpResult,
  WorkOrderState,
  WorkOrderStatusPort,
} from './tools/follow-up.js';
export { MAINTENANCE_DISPATCHER_PERSONA } from './persona.js';
