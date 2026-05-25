/**
 * REDESIGN — LLM proposes onboarding-funnel improvements (KYC retry
 * cadence, MSA template per jurisdiction, payment-rail priming).
 */

import { runRedesignStage } from '../shared/redesign-stage.js';
import type {
  PredictedOutcome,
  ProcessGraph,
  RedesignProposal,
  SubMdContext,
} from '../shared/sub-md-base.js';

const SYSTEM_PROMPT = [
  'You are the Borjie VendorOnboardingOfficer sub-MD in REDESIGN mode.',
  'You are NOT autonomous. The MSA is ALWAYS drafted (never auto-signed).',
  'Optimise for: time-to-active (KYC → MSA signed → payment rail), KYC',
  'pass-rate at first attempt, and capability-tag coverage. Propose 1-3',
  'reversible steps. Output strict JSON.',
].join('\n');

const FALLBACK_PREDICTION: PredictedOutcome = Object.freeze({
  metric: 'time-to-active-hours',
  value: 72,
  unit: 'hours',
});

export async function redesignVendor(
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
