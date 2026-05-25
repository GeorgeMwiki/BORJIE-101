/**
 * lease.coordinator — public API for the Tier-C sub-MD.
 *
 * Manages the lease lifecycle: detect 60-day renewal window → draft
 * renewal with retention forecast → classify tenant termination
 * requests → draft termination response. **All outputs are drafts**;
 * owner reviews and signs.
 *
 * Touches the forecasting-engine retention curve via an injected port
 * (see `RetentionForecastPort` in tools/draft-renewal.ts).
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
import { automateLease } from './automate.js';
import { mapLease } from './map.js';
import { observeLease } from './observe.js';
import { LEASE_COORDINATOR_PERSONA } from './persona.js';
import { redesignLease } from './redesign.js';

export const LEASE_COORDINATOR_NAME = 'lease.coordinator';

export const LEASE_COORDINATOR_TOOLS = Object.freeze([
  'lease.detect_renewal_window',
  'lease.draft_renewal',
  'lease.classify_termination_request',
  'lease.draft_termination_response',
] as const);

export interface LeaseCoordinatorSubMdArgs {
  readonly scope: ScopeFilter;
  readonly recorder?: OutcomeRecorder;
}

export function createLeaseCoordinatorSubMd(
  args: LeaseCoordinatorSubMdArgs,
): SubMd {
  const recorder = args.recorder ?? createOutcomeRecorder();
  return Object.freeze({
    name: LEASE_COORDINATOR_NAME,
    persona: LEASE_COORDINATOR_PERSONA,
    scope: args.scope,
    toolBelt: LEASE_COORDINATOR_TOOLS,
    // Tier-C: all writes are drafts; the sub-MD itself is read-only.
    riskTier: 'read',

    observe(ctx: SubMdContext): AsyncIterable<ObservedEvent> {
      return {
        [Symbol.asyncIterator]: async function* () {
          const collected = await observeLease(ctx);
          for (const evt of collected) yield evt;
        },
      };
    },
    async map(events: ReadonlyArray<ObservedEvent>, _ctx: SubMdContext): Promise<ProcessGraph> {
      return mapLease(events);
    },
    async redesign(graph: ProcessGraph, ctx: SubMdContext): Promise<RedesignProposal> {
      return redesignLease(graph, ctx);
    },
    async automate(proposal: RedesignProposal, ctx: SubMdContext): Promise<AutomationArtifact> {
      return automateLease(proposal, ctx.budget);
    },
    async recordOutcome(actual: ActualOutcome, predicted: PredictedOutcome): Promise<void> {
      await recorder.record({ subMdName: LEASE_COORDINATOR_NAME, predicted, actual });
    },
  });
}

export { detectRenewalWindow } from './tools/detect-renewal-window.js';
export type {
  DetectRenewalWindowArgs,
  RenewalWindowResult,
  RenewalWindowState,
} from './tools/detect-renewal-window.js';
export { draftRenewal } from './tools/draft-renewal.js';
export type {
  DraftRenewalArgs,
  DraftedRenewal,
  MarketComp,
  RetentionForecastPort,
} from './tools/draft-renewal.js';
export { classifyTerminationRequest } from './tools/classify-termination-request.js';
export type {
  ClassifiedTermination,
  TerminationKind,
} from './tools/classify-termination-request.js';
export { draftTerminationResponse } from './tools/draft-termination-response.js';
export type {
  DraftTerminationResponseArgs,
  DraftedTerminationResponse,
} from './tools/draft-termination-response.js';
export { LEASE_COORDINATOR_PERSONA } from './persona.js';
