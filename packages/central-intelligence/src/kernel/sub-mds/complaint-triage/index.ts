/**
 * complaint.triage — public API for the Tier-A sub-MD.
 *
 * Evidence: 89-96% BERT classification accuracy, well-studied,
 * low-stakes (every decision human-confirmable). No documented
 * major failure cases.
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
import { automateComplaints } from './automate.js';
import { mapComplaints } from './map.js';
import { observeComplaints } from './observe.js';
import { COMPLAINT_TRIAGE_PERSONA } from './persona.js';
import { redesignComplaints } from './redesign.js';

export const COMPLAINT_TRIAGE_NAME = 'complaint.triage';

export const COMPLAINT_TRIAGE_TOOLS = Object.freeze([
  'complaint.classify',
  'complaint.route',
  'complaint.empathize_response',
  'complaint.escalate_when_needed',
] as const);

export interface ComplaintTriageSubMdArgs {
  readonly scope: ScopeFilter;
  readonly recorder?: OutcomeRecorder;
}

export function createComplaintTriageSubMd(args: ComplaintTriageSubMdArgs): SubMd {
  const recorder = args.recorder ?? createOutcomeRecorder();

  return Object.freeze({
    name: COMPLAINT_TRIAGE_NAME,
    persona: COMPLAINT_TRIAGE_PERSONA,
    scope: args.scope,
    toolBelt: COMPLAINT_TRIAGE_TOOLS,
    riskTier: 'mutate',

    observe(ctx: SubMdContext): AsyncIterable<ObservedEvent> {
      return {
        [Symbol.asyncIterator]: async function* () {
          const collected = await observeComplaints(ctx);
          for (const evt of collected) yield evt;
        },
      };
    },

    async map(
      events: ReadonlyArray<ObservedEvent>,
      _ctx: SubMdContext,
    ): Promise<ProcessGraph> {
      return mapComplaints(events);
    },

    async redesign(
      graph: ProcessGraph,
      ctx: SubMdContext,
    ): Promise<RedesignProposal> {
      return redesignComplaints(graph, ctx);
    },

    async automate(
      proposal: RedesignProposal,
      ctx: SubMdContext,
    ): Promise<AutomationArtifact> {
      return automateComplaints(proposal, ctx.budget);
    },

    async recordOutcome(actual: ActualOutcome, predicted: PredictedOutcome): Promise<void> {
      await recorder.record({
        subMdName: COMPLAINT_TRIAGE_NAME,
        predicted,
        actual,
      });
    },
  });
}

export { classifyComplaint } from './tools/classify-complaint.js';
export type {
  ClassifiedComplaint,
  ComplaintCategory,
  ComplaintSentiment,
  ComplaintSeverity,
} from './tools/classify-complaint.js';
export { routeComplaint } from './tools/route-complaint.js';
export type {
  RouteComplaintArgs,
  RouteComplaintResult,
  RoutingDesk,
} from './tools/route-complaint.js';
export { empathizeResponse } from './tools/empathize-response.js';
export type {
  EmpathizeResponseArgs,
  EmpathyDraft,
} from './tools/empathize-response.js';
export { escalateWhenNeeded } from './tools/escalate-when-needed.js';
export type {
  EscalateArgs,
  EscalationChannel,
  EscalationDirective,
} from './tools/escalate-when-needed.js';
export { COMPLAINT_TRIAGE_PERSONA } from './persona.js';
