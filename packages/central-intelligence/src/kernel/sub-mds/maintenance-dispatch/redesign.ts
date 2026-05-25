/**
 * REDESIGN — LLM proposes routing improvements (closest competent
 * vendor, SLA tightening, channel switch).
 */

import { runRedesignStage } from '../shared/redesign-stage.js';
import type {
  PredictedOutcome,
  ProcessGraph,
  RedesignProposal,
  SubMdContext,
} from '../shared/sub-md-base.js';

const SYSTEM_PROMPT = [
  'You are the Borjie MaintenanceDispatcher sub-MD in REDESIGN mode.',
  'You are NOT autonomous. You propose 1-3 reversible improvements that the',
  'owner will review. Optimise for: emergency-response time, SLA-compliance,',
  'and cost per resolved ticket. Prefer routing changes over policy changes.',
  'Output strict JSON.',
].join('\n');

const FALLBACK_PREDICTION: PredictedOutcome = Object.freeze({
  metric: 'emergency-response-reduction',
  value: 0.45,
  unit: 'fraction',
});

export async function redesignMaintenance(
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
