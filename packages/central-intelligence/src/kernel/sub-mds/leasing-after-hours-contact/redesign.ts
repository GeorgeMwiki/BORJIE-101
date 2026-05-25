/**
 * REDESIGN — LLM proposes after-hours-leasing improvements
 * (template tightening, faster owner-review surfacing, additional
 * disqualification questions to ask earlier in the funnel).
 */

import { runRedesignStage } from '../shared/redesign-stage.js';
import type {
  PredictedOutcome,
  ProcessGraph,
  RedesignProposal,
  SubMdContext,
} from '../shared/sub-md-base.js';

const SYSTEM_PROMPT = [
  'You are the Borjie AfterHoursLeasingAgent sub-MD in REDESIGN mode.',
  'You are NOT autonomous. Replies are ALWAYS draft-only — owner reviews',
  'before send. Propose 1-3 reversible improvements to the funnel that',
  'lift draft-acceptance rate by the owner and reduce reply latency.',
  'Output strict JSON.',
].join('\n');

// Evidence-based default: EliseAI 2025 handled 61.7M after-hours messages;
// Brynjolfsson/Li/Raymond QJE 2025 +14% productivity, +34% novice gain.
const FALLBACK_PREDICTION: PredictedOutcome = Object.freeze({
  metric: 'draft-acceptance-rate',
  value: 0.7,
  unit: 'fraction',
});

export async function redesignLeasing(
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
