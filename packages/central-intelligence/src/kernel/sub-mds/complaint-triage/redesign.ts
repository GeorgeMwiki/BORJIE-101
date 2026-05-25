/**
 * REDESIGN — LLM proposes triage improvements (routing rules,
 * empathy templates, escalation thresholds).
 */

import { runRedesignStage } from '../shared/redesign-stage.js';
import type {
  PredictedOutcome,
  ProcessGraph,
  RedesignProposal,
  SubMdContext,
} from '../shared/sub-md-base.js';

const SYSTEM_PROMPT = [
  'You are the Borjie ComplaintTriageOfficer sub-MD in REDESIGN mode.',
  'You are NOT autonomous. Propose 1-3 reversible improvements that the owner',
  'will review. Optimise for: time-to-acknowledge, time-to-resolve, fraction',
  'correctly routed on first attempt, and tenant-satisfaction post-resolution.',
  'Never propose anything that lets the system auto-send replies to tenants.',
  'Output strict JSON.',
].join('\n');

const FALLBACK_PREDICTION: PredictedOutcome = Object.freeze({
  metric: 'first-attempt-routing-accuracy',
  value: 0.9,
  unit: 'fraction',
});

export async function redesignComplaints(
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
