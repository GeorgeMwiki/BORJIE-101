/**
 * tra.filing_assistant — public API for the Tier-C sub-MD.
 *
 * Preparation-only. The sub-MD compiles the royalty-return batch,
 * validates it, drafts the filing payload, and fetches status of
 * filings that have already been submitted. **It does NOT submit.**
 * Actual submission is HQ-tier `platform.file_kra_mri` and stays gated
 * by four-eye approval.
 *
 * Touches `services/mcp-server-process-intel` (process variants per
 * owner) via callsites the MD wires — this sub-MD's tool surface stays
 * pure; the MCP integration lives in composition.
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
import { automateTraFiling } from './automate.js';
import { mapTraFiling } from './map.js';
import { observeTraFiling } from './observe.js';
import { TRA_FILING_ASSISTANT_PERSONA } from './persona.js';
import { redesignTraFiling } from './redesign.js';

export const TRA_FILING_ASSISTANT_NAME = 'tra.filing_assistant';

export const TRA_FILING_ASSISTANT_TOOLS = Object.freeze([
  'kra.compile_mri_batch',
  'kra.validate_pre_filing',
  'kra.draft_filing',
  'kra.fetch_filing_status',
] as const);

export interface TraFilingAssistantSubMdArgs {
  readonly scope: ScopeFilter;
  readonly recorder?: OutcomeRecorder;
}

export function createTraFilingAssistantSubMd(
  args: TraFilingAssistantSubMdArgs,
): SubMd {
  const recorder = args.recorder ?? createOutcomeRecorder();
  return Object.freeze({
    name: TRA_FILING_ASSISTANT_NAME,
    persona: TRA_FILING_ASSISTANT_PERSONA,
    scope: args.scope,
    toolBelt: TRA_FILING_ASSISTANT_TOOLS,
    // Tier-C: preparation only; submission is HQ-tier elsewhere.
    riskTier: 'read',

    observe(ctx: SubMdContext): AsyncIterable<ObservedEvent> {
      return {
        [Symbol.asyncIterator]: async function* () {
          const collected = await observeTraFiling(ctx);
          for (const evt of collected) yield evt;
        },
      };
    },
    async map(events: ReadonlyArray<ObservedEvent>, _ctx: SubMdContext): Promise<ProcessGraph> {
      return mapTraFiling(events);
    },
    async redesign(graph: ProcessGraph, ctx: SubMdContext): Promise<RedesignProposal> {
      return redesignTraFiling(graph, ctx);
    },
    async automate(proposal: RedesignProposal, ctx: SubMdContext): Promise<AutomationArtifact> {
      return automateTraFiling(proposal, ctx.budget);
    },
    async recordOutcome(actual: ActualOutcome, predicted: PredictedOutcome): Promise<void> {
      await recorder.record({ subMdName: TRA_FILING_ASSISTANT_NAME, predicted, actual });
    },
  });
}

export { compileMriBatch } from './tools/compile-mri-batch.js';
export type {
  CompileMriBatchArgs,
  CompiledMriBatch,
  CompiledMriLine,
  RentalIncomeRecord,
} from './tools/compile-mri-batch.js';
export { validatePreFiling } from './tools/validate-pre-filing.js';
export type { ValidationIssue, ValidationResult } from './tools/validate-pre-filing.js';
export { draftFiling } from './tools/draft-filing.js';
export type {
  DraftErritsPayload,
  DraftFilingArgs,
  ErritsLine,
} from './tools/draft-filing.js';
export { fetchFilingStatus } from './tools/fetch-filing-status.js';
export type {
  FetchFilingStatusArgs,
  FetchFilingStatusResult,
  FilingStatus,
  FilingStatusPort,
} from './tools/fetch-filing-status.js';
export { TRA_FILING_ASSISTANT_PERSONA } from './persona.js';
