/**
 * after_hours_contact — public API for the Tier-B sub-MD.
 *
 * Handles prospective-buyer / counterparty inquiries that arrive
 * outside office hours: classify intent → match available mineral lots
 * → draft a reply → propose site-inspection slots. **Every outbound
 * message is a DRAFT** queued for owner review before send.
 *
 * Evidence (R3 audit):
 *  - After-hours inbound capture: a substantial share of buyer/off-taker
 *    inquiries land outside trading hours; drafted-reply automation
 *    closes the response-latency gap without committing the owner.
 *  - Brynjolfsson/Li/Raymond QJE 2025: +14% productivity, +34% for
 *    novices, -8.6% attrition. The strongest replicated finding in
 *    the labour-automation literature.
 *
 * Risk posture: Tier-B — DRAFT-only, owner reviews before send. The
 * sub-MD never commits lot availability, never quotes a final price,
 * and never books a site inspection without explicit owner approval.
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
import { automateAfterHours } from './automate.js';
import { mapAfterHours } from './map.js';
import { observeAfterHours } from './observe.js';
import { AFTER_HOURS_CONTACT_PERSONA } from './persona.js';
import { redesignAfterHours } from './redesign.js';

export const AFTER_HOURS_NAME = 'after_hours_contact';

export const AFTER_HOURS_TOOLS = Object.freeze([
  'after_hours.classify_inquiry',
  'after_hours.fetch_lot_match',
  'after_hours.draft_response',
  'after_hours.schedule_inspection_draft',
] as const);

export interface AfterHoursContactSubMdArgs {
  readonly scope: ScopeFilter;
  readonly recorder?: OutcomeRecorder;
}

export function createAfterHoursContactSubMd(
  args: AfterHoursContactSubMdArgs,
): SubMd {
  const recorder = args.recorder ?? createOutcomeRecorder();

  return Object.freeze({
    name: AFTER_HOURS_NAME,
    persona: AFTER_HOURS_CONTACT_PERSONA,
    scope: args.scope,
    toolBelt: AFTER_HOURS_TOOLS,
    // DRAFT-only — the sub-MD itself never executes a write. The
    // toolbelt produces drafts that the MD's policy gate routes to
    // the owner-review queue.
    riskTier: 'read',

    observe(ctx: SubMdContext): AsyncIterable<ObservedEvent> {
      return {
        [Symbol.asyncIterator]: async function* () {
          const collected = await observeAfterHours(ctx);
          for (const evt of collected) yield evt;
        },
      };
    },

    async map(events: ReadonlyArray<ObservedEvent>, _ctx: SubMdContext): Promise<ProcessGraph> {
      return mapAfterHours(events);
    },

    async redesign(graph: ProcessGraph, ctx: SubMdContext): Promise<RedesignProposal> {
      return redesignAfterHours(graph, ctx);
    },

    async automate(proposal: RedesignProposal, ctx: SubMdContext): Promise<AutomationArtifact> {
      return automateAfterHours(proposal, ctx.budget);
    },

    async recordOutcome(actual: ActualOutcome, predicted: PredictedOutcome): Promise<void> {
      await recorder.record({
        subMdName: AFTER_HOURS_NAME,
        predicted,
        actual,
      });
    },
  });
}

export { classifyInquiry } from './tools/classify-inquiry.js';
export type {
  ClassifiedInquiry,
  InquiryFeatures,
  InquiryIntent,
} from './tools/classify-inquiry.js';
export { fetchLotMatch } from './tools/fetch-lot-match.js';
export type {
  FetchLotMatchArgs,
  FetchLotMatchResult,
  LotRecord,
  MatchedLot,
} from './tools/fetch-lot-match.js';
export { draftResponse } from './tools/draft-response.js';
export type { DraftResponseArgs, DraftedResponse } from './tools/draft-response.js';
export { scheduleInspectionDraft } from './tools/schedule-inspection-draft.js';
export type {
  OwnerCalendarSlot,
  ProposedSlot,
  ScheduleInspectionDraftArgs,
  ScheduleInspectionDraftResult,
} from './tools/schedule-inspection-draft.js';
export { AFTER_HOURS_CONTACT_PERSONA } from './persona.js';
