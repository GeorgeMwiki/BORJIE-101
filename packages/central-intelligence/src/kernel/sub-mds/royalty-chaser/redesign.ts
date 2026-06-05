/**
 * REDESIGN — LLM proposes royalty/payment-cycle improvements (earlier
 * soft reminder, settlement-plan tuning, channel switch).
 */

import { runRedesignStage } from '../shared/redesign-stage.js';
import type {
  PredictedOutcome,
  ProcessGraph,
  RedesignProposal,
  SubMdContext,
} from '../shared/sub-md-base.js';

const SYSTEM_PROMPT = [
  'You are the Borjie RoyaltyCoordinator sub-MD in REDESIGN mode.',
  'You are NOT autonomous. Filing any legal notice is OUT OF SCOPE for',
  'this sub-MD — never propose auto-filing notices. Optimise for:',
  'cure-rate on day-7, cure-rate on day-30, and minimised counterparty',
  'churn. Propose 1-3 reversible steps. Output strict JSON.',
].join('\n');

const FALLBACK_PREDICTION: PredictedOutcome = Object.freeze({
  metric: 'day7-cure-rate',
  value: 0.55,
  unit: 'fraction',
});

export async function redesignArrears(
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
