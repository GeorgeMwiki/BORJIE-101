/**
 * cost-efficiency scorer.
 *
 * Score = clamp(resolutionQuality / normalisedCost, 0, 1), where the cost
 * is normalised against a per-scenario baseline budget. Scenarios with
 * higher complexity have higher baseline budgets.
 *
 * If `resolutionQuality` is unset, falls back to 0.5 (neutral).
 */

import type { Scorer } from './types.js';

// USD-cents baseline budget per scenario. Calibrated for Phase E.4
// scaffolding — Phase E.5 may retune from real runs.
const SCENARIO_BUDGET_CENTS: Readonly<Record<string, number>> = Object.freeze({
  'arrears-triage': 8,
  'maintenance-dispatch': 10,
  'kra-filing': 25,
  'lease-renewal': 15,
  'complaint-triage': 8,
});

export const costEfficiency: Scorer = (fixture, run) => {
  const budget = SCENARIO_BUDGET_CENTS[fixture.scenario] ?? 10;
  const quality = run.resolutionQuality ?? 0.5;
  const actual = Math.max(1, run.costUsdCents);
  // efficiency = quality * (budget / actual); when actual = budget, efficiency = quality.
  const raw = quality * (budget / actual);
  const score = Math.max(0, Math.min(1, raw));
  return {
    scorer: 'cost-efficiency',
    score,
    rationale: `quality=${quality} cost=${actual}c budget=${budget}c → ${score.toFixed(3)}`,
  };
};
