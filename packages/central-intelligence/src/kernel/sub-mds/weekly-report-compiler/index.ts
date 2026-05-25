/**
 * report.weekly_compiler — public API for the Tier-C sub-MD.
 *
 * Pure read/draft. Gathers KPIs, detects anomalies vs forecast, drafts
 * the weekly briefing the owner reads each Monday. Every claim cites
 * its source row via the Citations API.
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
import { automateReport } from './automate.js';
import { mapReport } from './map.js';
import { observeReport } from './observe.js';
import { WEEKLY_REPORT_COMPILER_PERSONA } from './persona.js';
import { redesignReport } from './redesign.js';

export const WEEKLY_REPORT_COMPILER_NAME = 'report.weekly_compiler';

export const WEEKLY_REPORT_COMPILER_TOOLS = Object.freeze([
  'report.gather_kpis',
  'report.detect_anomalies',
  'report.draft_briefing',
  'report.cite_evidence',
] as const);

export interface WeeklyReportCompilerSubMdArgs {
  readonly scope: ScopeFilter;
  readonly recorder?: OutcomeRecorder;
}

export function createWeeklyReportCompilerSubMd(
  args: WeeklyReportCompilerSubMdArgs,
): SubMd {
  const recorder = args.recorder ?? createOutcomeRecorder();
  return Object.freeze({
    name: WEEKLY_REPORT_COMPILER_NAME,
    persona: WEEKLY_REPORT_COMPILER_PERSONA,
    scope: args.scope,
    toolBelt: WEEKLY_REPORT_COMPILER_TOOLS,
    riskTier: 'read',

    observe(ctx: SubMdContext): AsyncIterable<ObservedEvent> {
      return {
        [Symbol.asyncIterator]: async function* () {
          const collected = await observeReport(ctx);
          for (const evt of collected) yield evt;
        },
      };
    },
    async map(events: ReadonlyArray<ObservedEvent>, _ctx: SubMdContext): Promise<ProcessGraph> {
      return mapReport(events);
    },
    async redesign(graph: ProcessGraph, ctx: SubMdContext): Promise<RedesignProposal> {
      return redesignReport(graph, ctx);
    },
    async automate(proposal: RedesignProposal, ctx: SubMdContext): Promise<AutomationArtifact> {
      return automateReport(proposal, ctx.budget);
    },
    async recordOutcome(actual: ActualOutcome, predicted: PredictedOutcome): Promise<void> {
      await recorder.record({ subMdName: WEEKLY_REPORT_COMPILER_NAME, predicted, actual });
    },
  });
}

export { gatherKpis } from './tools/gather-kpis.js';
export type {
  ArrearsKpis,
  CashflowKpis,
  ComplaintKpis,
  GatherKpisArgs,
  KpiCitation,
  KpiDataPort,
  MaintenanceKpis,
  OccupancyKpis,
  PortfolioKpiSnapshot,
} from './tools/gather-kpis.js';
export { detectAnomalies } from './tools/detect-anomalies.js';
export type {
  Anomaly,
  DetectAnomaliesArgs,
  DetectAnomaliesResult,
  ForecastReplayPort,
  ForecastSnapshot,
} from './tools/detect-anomalies.js';
export { draftBriefing } from './tools/draft-briefing.js';
export type { DraftBriefingArgs, DraftedBriefing } from './tools/draft-briefing.js';
export { citeEvidence } from './tools/cite-evidence.js';
export type { CiteEvidenceArgs, CiteEvidenceResult, Citation } from './tools/cite-evidence.js';
export { WEEKLY_REPORT_COMPILER_PERSONA } from './persona.js';
