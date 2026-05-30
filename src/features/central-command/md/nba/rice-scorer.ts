/**
 * RICE scorer — Reach x Impact x Confidence / Effort.
 *
 * Reference: Intercom's RICE framework. Effort here is in person-days; reach
 * is the number of people/customers/units the action touches per quarter.
 *
 * Pure functions. No I/O. No mutation.
 *
 * @module features/central-command/md/nba/rice-scorer
 */

import { clamp, round } from "./ice-scorer";
import type { ActionCandidate, RiceScore } from "./types";

/** Compute the RICE score for an action candidate. */
export function scoreRice(candidate: ActionCandidate): RiceScore {
  const { template, contextualImpactLift, contextualConfidenceLift } =
    candidate;

  const reach = Math.max(0, template.baselineReach);
  const impact = clamp(template.baselineImpact + contextualImpactLift, 0, 10);
  const confidence = clamp(
    template.baselineConfidence + contextualConfidenceLift,
    0,
    1,
  );
  // Effort must be > 0 to keep RICE finite; floor at 0.1 person-day.
  const effortPersonDays = Math.max(0.1, template.effortPersonDays);

  const rice = round((reach * impact * confidence) / effortPersonDays, 3);

  return Object.freeze({
    reach,
    impact,
    confidence,
    effortPersonDays,
    rice,
  });
}

/** Primitive RICE computation — useful for tests. */
export function computeRice(
  reach: number,
  impact: number,
  confidence: number,
  effort: number,
): number {
  const r = Math.max(0, reach);
  const i = clamp(impact, 0, 10);
  const c = clamp(confidence, 0, 1);
  const e = Math.max(0.1, effort);
  return round((r * i * c) / e, 3);
}
