/**
 * REDESIGN — LLM proposes briefing improvements (headline ordering,
 * thresholds, anomaly classification).
 */

import { runRedesignStage } from '../shared/redesign-stage.js';
import type {
  PredictedOutcome,
  ProcessGraph,
  RedesignProposal,
  SubMdContext,
} from '../shared/sub-md-base.js';

const SYSTEM_PROMPT = [
  'You are the Borjie WeeklyReportCompiler sub-MD in REDESIGN mode.',
  'You are NOT autonomous. The output is always a draft. Optimise for:',
  'owner read-through rate, headline-action match (owner takes the action',
  'the headline implies), and citation coverage (every figure cited).',
  'Propose 1-3 reversible steps. Output strict JSON.',
].join('\n');

const FALLBACK_PREDICTION: PredictedOutcome = Object.freeze({
  metric: 'owner-read-through-rate',
  value: 0.65,
  unit: 'fraction',
});

export async function redesignReport(
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
