/**
 * leasing.after_hours_contact — public API for the Tier-B sub-MD.
 *
 * Evidence (R3 audit):
 *  - EliseAI 2025: 61.7M after-hours messages handled across multi-
 *    family portfolios; replicated lift in inquiry-to-tour conversion.
 *  - Brynjolfsson/Li/Raymond QJE 2025: +14% productivity, +34% for
 *    novices, -8.6% attrition. The strongest replicated finding in
 *    the labour-automation literature.
 *
 * Risk posture: Tier-B — DRAFT-only, owner reviews before send. The
 * sub-MD never commits availability, never quotes a final price, and
 * never books a viewing without explicit owner approval.
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
import { automateLeasing } from './automate.js';
import { mapLeasing } from './map.js';
import { observeLeasing } from './observe.js';
import { AFTER_HOURS_LEASING_PERSONA } from './persona.js';
import { redesignLeasing } from './redesign.js';

export const LEASING_AFTER_HOURS_NAME = 'leasing.after_hours_contact';

export const LEASING_AFTER_HOURS_TOOLS = Object.freeze([
  'leasing.classify_inquiry',
  'leasing.fetch_unit_match',
  'leasing.draft_response',
  'leasing.schedule_viewing_draft',
] as const);

export interface LeasingAfterHoursSubMdArgs {
  readonly scope: ScopeFilter;
  readonly recorder?: OutcomeRecorder;
}

export function createLeasingAfterHoursSubMd(
  args: LeasingAfterHoursSubMdArgs,
): SubMd {
  const recorder = args.recorder ?? createOutcomeRecorder();

  return Object.freeze({
    name: LEASING_AFTER_HOURS_NAME,
    persona: AFTER_HOURS_LEASING_PERSONA,
    scope: args.scope,
    toolBelt: LEASING_AFTER_HOURS_TOOLS,
    // DRAFT-only — the sub-MD itself never executes a write. The
    // toolbelt produces drafts that the MD's policy gate routes to
    // the owner-review queue.
    riskTier: 'read',

    observe(ctx: SubMdContext): AsyncIterable<ObservedEvent> {
      return {
        [Symbol.asyncIterator]: async function* () {
          const collected = await observeLeasing(ctx);
          for (const evt of collected) yield evt;
        },
      };
    },

    async map(events: ReadonlyArray<ObservedEvent>, _ctx: SubMdContext): Promise<ProcessGraph> {
      return mapLeasing(events);
    },

    async redesign(graph: ProcessGraph, ctx: SubMdContext): Promise<RedesignProposal> {
      return redesignLeasing(graph, ctx);
    },

    async automate(proposal: RedesignProposal, ctx: SubMdContext): Promise<AutomationArtifact> {
      return automateLeasing(proposal, ctx.budget);
    },

    async recordOutcome(actual: ActualOutcome, predicted: PredictedOutcome): Promise<void> {
      await recorder.record({
        subMdName: LEASING_AFTER_HOURS_NAME,
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
export { fetchUnitMatch } from './tools/fetch-unit-match.js';
export type {
  FetchUnitMatchArgs,
  FetchUnitMatchResult,
  MatchedUnit,
  UnitRecord,
} from './tools/fetch-unit-match.js';
export { draftResponse } from './tools/draft-response.js';
export type { DraftResponseArgs, DraftedResponse } from './tools/draft-response.js';
export { scheduleViewingDraft } from './tools/schedule-viewing-draft.js';
export type {
  OwnerCalendarSlot,
  ProposedSlot,
  ScheduleViewingDraftArgs,
  ScheduleViewingDraftResult,
} from './tools/schedule-viewing-draft.js';
export { AFTER_HOURS_LEASING_PERSONA } from './persona.js';
