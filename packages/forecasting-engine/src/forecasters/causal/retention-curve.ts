/**
 * RetentionCurve — P(counterparty retained | royalty change Δ%).
 *
 * Hand-coded sigmoid: small increases barely move retention; large
 * increases collapse it. Tenure adds inertia (long-standing
 * counterparties tolerate more), market tightness reduces
 * alternatives.
 *
 * Monotonicity: P(retain) is non-increasing in royaltyChangePct.
 */

import type { CausalModel } from './causal-model.js';

export interface RetentionInput {
  readonly royaltyChangePct: number; // e.g. 0.05 = +5%
  readonly counterpartyTenureDays: number;
  readonly marketAvailableCapacityRate: number; // 0..1 in micro-market
}

export interface RetentionOutput {
  readonly probabilityRetained: number; // 0..1
  readonly drivers: ReadonlyArray<string>;
}

function sigmoid(x: number): number {
  const z = Math.max(-50, Math.min(50, x));
  return 1 / (1 + Math.exp(-z));
}

export const retentionCurve: CausalModel<RetentionInput, RetentionOutput> = {
  meta: {
    id: 'retention.curve.v1',
    description:
      'Hand-coded retention probability as a function of royalty change, tenure, and market.',
    inputName: 'royaltyChangePct',
    outputName: 'probabilityRetained',
    monotonicity: 'decreasing',
    domain: { min: -0.5, max: 0.5 },
    source: 'hand-coded',
  },
  apply(input) {
    const x = input.royaltyChangePct;
    const tenureYears = input.counterpartyTenureDays / 365;
    // Larger negative shift = larger drop. We center the sigmoid
    // around +10% increase (the typical break-point) and scale to
    // shrink retention more sharply beyond that.
    const center = 0.1;
    const tenureBoost = Math.min(0.15, tenureYears * 0.02); // long tenure = more inertia
    const marketPressure = Math.max(0, 0.1 - input.marketAvailableCapacityRate); // tight market = more retention
    const z = -20 * (x - center - tenureBoost - marketPressure);
    const p = sigmoid(z);
    const drivers: string[] = [];
    if (x > center) drivers.push(`royaltyChange ${(x * 100).toFixed(1)}% exceeds typical tolerance`);
    if (tenureYears > 3) drivers.push(`long tenure (${tenureYears.toFixed(1)}y) cushions impact`);
    if (input.marketAvailableCapacityRate > 0.1) drivers.push('loose market → counterparty has alternatives');
    return { probabilityRetained: p, drivers };
  },
};
