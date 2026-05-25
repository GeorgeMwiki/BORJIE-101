/**
 * kra.filing_assistant — public API for the Tier-C sub-MD.
 *
 * Preparation-only. The sub-MD compiles the MRI batch, validates it,
 * drafts the eRITS payload, and fetches status of filings that have
 * already been submitted. **It does NOT submit.** Actual submission is
 * HQ-tier `platform.file_kra_mri` and stays gated by four-eye approval.
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
import { automateKraFiling } from './automate.js';
import { mapKraFiling } from './map.js';
import { observeKraFiling } from './observe.js';
import { KRA_FILING_ASSISTANT_PERSONA } from './persona.js';
import { redesignKraFiling } from './redesign.js';

export const KRA_FILING_ASSISTANT_NAME = 'kra.filing_assistant';

export const KRA_FILING_ASSISTANT_TOOLS = Object.freeze([
  'kra.compile_mri_batch',
  'kra.validate_pre_filing',
  'kra.draft_filing',
  'kra.fetch_filing_status',
] as const);

export interface KraFilingAssistantSubMdArgs {
  readonly scope: ScopeFilter;
  readonly recorder?: OutcomeRecorder;
}

export function createKraFilingAssistantSubMd(
  args: KraFilingAssistantSubMdArgs,
): SubMd {
  const recorder = args.recorder ?? createOutcomeRecorder();
  return Object.freeze({
    name: KRA_FILING_ASSISTANT_NAME,
    persona: KRA_FILING_ASSISTANT_PERSONA,
    scope: args.scope,
    toolBelt: KRA_FILING_ASSISTANT_TOOLS,
    // Tier-C: preparation only; submission is HQ-tier elsewhere.
    riskTier: 'read',

    observe(ctx: SubMdContext): AsyncIterable<ObservedEvent> {
      return {
        [Symbol.asyncIterator]: async function* () {
          const collected = await observeKraFiling(ctx);
          for (const evt of collected) yield evt;
        },
      };
    },
    async map(events: ReadonlyArray<ObservedEvent>, _ctx: SubMdContext): Promise<ProcessGraph> {
      return mapKraFiling(events);
    },
    async redesign(graph: ProcessGraph, ctx: SubMdContext): Promise<RedesignProposal> {
      return redesignKraFiling(graph, ctx);
    },
    async automate(proposal: RedesignProposal, ctx: SubMdContext): Promise<AutomationArtifact> {
      return automateKraFiling(proposal, ctx.budget);
    },
    async recordOutcome(actual: ActualOutcome, predicted: PredictedOutcome): Promise<void> {
      await recorder.record({ subMdName: KRA_FILING_ASSISTANT_NAME, predicted, actual });
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
export { KRA_FILING_ASSISTANT_PERSONA } from './persona.js';
