/**
 * arrears.chaser — public API for the Tier-B sub-MD.
 *
 * The sub-MD escalates arrears through soft → firm → call → drafted
 * notice. **It never files an eviction notice.** Eviction filing is
 * HQ-tier (`platform.evict_tenant`) and stays gated by four-eye
 * approval at the platform level.
 *
 * Risk posture: mutate (reversible SMS, audit-logged STK pushes
 * pre-approved; voice calls are external-comm — four-eye OR pre-
 * approved policy). Draft-notice is read-tier draft-only.
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
import { automateArrears } from './automate.js';
import { mapArrears } from './map.js';
import { observeArrears } from './observe.js';
import { ARREARS_CHASER_PERSONA } from './persona.js';
import { redesignArrears } from './redesign.js';

export const ARREARS_CHASER_NAME = 'arrears.chaser';

export const ARREARS_CHASER_TOOLS = Object.freeze([
  'arrears.classify_severity',
  'arrears.send_reminder',
  'arrears.escalate_to_call',
  'arrears.draft_notice',
] as const);

export interface ArrearsChaserSubMdArgs {
  readonly scope: ScopeFilter;
  readonly recorder?: OutcomeRecorder;
}

export function createArrearsChaserSubMd(args: ArrearsChaserSubMdArgs): SubMd {
  const recorder = args.recorder ?? createOutcomeRecorder();
  return Object.freeze({
    name: ARREARS_CHASER_NAME,
    persona: ARREARS_CHASER_PERSONA,
    scope: args.scope,
    toolBelt: ARREARS_CHASER_TOOLS,
    riskTier: 'mutate',

    observe(ctx: SubMdContext): AsyncIterable<ObservedEvent> {
      return {
        [Symbol.asyncIterator]: async function* () {
          const collected = await observeArrears(ctx);
          for (const evt of collected) yield evt;
        },
      };
    },
    async map(events: ReadonlyArray<ObservedEvent>, _ctx: SubMdContext): Promise<ProcessGraph> {
      return mapArrears(events);
    },
    async redesign(graph: ProcessGraph, ctx: SubMdContext): Promise<RedesignProposal> {
      return redesignArrears(graph, ctx);
    },
    async automate(proposal: RedesignProposal, ctx: SubMdContext): Promise<AutomationArtifact> {
      return automateArrears(proposal, ctx.budget);
    },
    async recordOutcome(actual: ActualOutcome, predicted: PredictedOutcome): Promise<void> {
      await recorder.record({ subMdName: ARREARS_CHASER_NAME, predicted, actual });
    },
  });
}

export { classifySeverity } from './tools/classify-severity.js';
export type {
  ArrearsSeverity,
  ClassifiedSeverity,
  ClassifySeverityArgs,
  TenantHistory,
} from './tools/classify-severity.js';
export { sendReminder } from './tools/send-reminder.js';
export type {
  ReminderChannel,
  ReminderDraft,
  ReminderTransport,
  ReminderAuditSink,
  SendReminderArgs,
  SendReminderResult,
} from './tools/send-reminder.js';
export { escalateToCall, renderCallScript } from './tools/escalate-to-call.js';
export type {
  CallScript,
  CallTransport,
  EscalateToCallArgs,
  EscalateToCallResult,
} from './tools/escalate-to-call.js';
export { draftNotice } from './tools/draft-notice.js';
export type { DraftNoticeArgs, DraftedNotice } from './tools/draft-notice.js';
export { ARREARS_CHASER_PERSONA } from './persona.js';
