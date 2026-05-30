/**
 * WSJF scorer — Weighted Shortest Job First (SAFe).
 *
 *   costOfDelay = userBusinessValue + timeCriticality + RR/OE
 *   wsjf        = costOfDelay / jobSize
 *
 * - userBusinessValue 0..10 (taken from baseline impact)
 * - timeCriticality 0..10 (lifted by contextualUrgencyLift)
 * - RR/OE 0..10 (proxied from confidence * 10 — high confidence enables more)
 * - jobSize = effortPersonDays (>= 0.1 to keep finite)
 *
 * Pure functions. Outputs are frozen.
 *
 * @module features/central-command/md/nba/wsjf-scorer
 */

import { clamp, round } from "./ice-scorer";
import type { ActionCandidate, WsjfScore } from "./types";

export function scoreWsjf(candidate: ActionCandidate): WsjfScore {
  const {
    template,
    contextualImpactLift,
    contextualConfidenceLift,
    contextualUrgencyLift,
  } = candidate;

  const userBusinessValue = clamp(
    template.baselineImpact + contextualImpactLift,
    0,
    10,
  );
  const timeCriticality = clamp(contextualUrgencyLift, 0, 10);
  const riskReductionOpportunityEnablement = clamp(
    (template.baselineConfidence + contextualConfidenceLift) * 10,
    0,
    10,
  );

  const costOfDelay = round(
    userBusinessValue + timeCriticality + riskReductionOpportunityEnablement,
    3,
  );

  const jobSize = Math.max(0.1, template.effortPersonDays);
  const wsjf = round(costOfDelay / jobSize, 3);

  return Object.freeze({
    userBusinessValue,
    timeCriticality,
    riskReductionOpportunityEnablement,
    jobSize,
    costOfDelay,
    wsjf,
  });
}

/** Primitive WSJF computation — for tests. */
export function computeWsjf(
  userBusinessValue: number,
  timeCriticality: number,
  riskReductionOpportunityEnablement: number,
  jobSize: number,
): number {
  const v = clamp(userBusinessValue, 0, 10);
  const t = clamp(timeCriticality, 0, 10);
  const r = clamp(riskReductionOpportunityEnablement, 0, 10);
  const j = Math.max(0.1, jobSize);
  return round((v + t + r) / j, 3);
}
