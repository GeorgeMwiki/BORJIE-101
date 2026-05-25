/**
 * REDESIGN — LLM proposes renewal-cycle improvements (earlier
 * notification, better retention messaging, market-driven anchoring).
 */

import { runRedesignStage } from '../shared/redesign-stage.js';
import type {
  PredictedOutcome,
  ProcessGraph,
  RedesignProposal,
  SubMdContext,
} from '../shared/sub-md-base.js';

const SYSTEM_PROMPT = [
  'You are the Borjie LeaseCoordinator sub-MD in REDESIGN mode.',
  'You are NOT autonomous. Renewal offers are ALWAYS draft-only. Optimise',
  'for: on-time renewal rate, retention forecast accuracy, and minimised',
  'vacancy gap. Propose 1-3 reversible steps. Output strict JSON.',
].join('\n');

const FALLBACK_PREDICTION: PredictedOutcome = Object.freeze({
  metric: 'on-time-renewal-rate',
  value: 0.7,
  unit: 'fraction',
});

export async function redesignLease(
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
