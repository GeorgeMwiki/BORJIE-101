/**
 * REDESIGN — LLM proposes filing-cycle improvements (earlier
 * compilation, schema-pre-check, KRA-PIN backfill cadence).
 */

import { runRedesignStage } from '../shared/redesign-stage.js';
import type {
  PredictedOutcome,
  ProcessGraph,
  RedesignProposal,
  SubMdContext,
} from '../shared/sub-md-base.js';

const SYSTEM_PROMPT = [
  'You are the Borjie KraFilingAssistant sub-MD in REDESIGN mode.',
  'You are NOT autonomous. NEVER propose auto-submission. Optimise for:',
  'on-time-by-day-15 rate (KRA monthly MRI deadline is the 20th, target a',
  'safety margin), zero-rejection rate, and minimised owner review time.',
  'Propose 1-3 reversible steps. Output strict JSON.',
].join('\n');

const FALLBACK_PREDICTION: PredictedOutcome = Object.freeze({
  metric: 'on-time-by-day15-rate',
  value: 0.85,
  unit: 'fraction',
});

export async function redesignKraFiling(
  graph: ProcessGraph,
  ctx: SubMdContext,
): Promise<RedesignProposal> {
  return runRedesignStage({
    graph,
    ctx,
    system: SYSTEM_PROMPT,
    fallbackPrediction: FALLBACK_PREDICTION,
  });
}
