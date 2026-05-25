/**
 * RetentionCurve — P(tenant retained | rent change Δ%).
 *
 * Hand-coded sigmoid: small increases barely move retention; large
 * increases collapse it. Tenure adds inertia (long-stayers tolerate
 * more), market tightness reduces alternatives.
 *
 * Monotonicity: P(retain) is non-increasing in rentChangePct.
 */

import type { CausalModel } from './causal-model.js';

export interface RetentionInput {
  readonly rentChangePct: number; // e.g. 0.05 = +5%
  readonly tenantTenureDays: number;
  readonly marketVacancyRate: number; // 0..1 in micro-market
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
      'Hand-coded retention probability as a function of rent change, tenure, and market.',
    inputName: 'rentChangePct',
    outputName: 'probabilityRetained',
    monotonicity: 'decreasing',
    domain: { min: -0.5, max: 0.5 },
    source: 'hand-coded',
  },
  apply(input) {
    const x = input.rentChangePct;
    const tenureYears = input.tenantTenureDays / 365;
    // Larger negative shift = larger drop. We center the sigmoid
    // around +10% increase (the typical break-point) and scale to
    // shrink retention more sharply beyond that.
    const center = 0.1;
    const tenureBoost = Math.min(0.15, tenureYears * 0.02); // long tenure = more inertia
    const marketPressure = Math.max(0, 0.1 - input.marketVacancyRate); // tight market = more retention
    const z = -20 * (x - center - tenureBoost - marketPressure);
    const p = sigmoid(z);
    const drivers: string[] = [];
    if (x > center) drivers.push(`rentChange ${(x * 100).toFixed(1)}% exceeds typical tolerance`);
    if (tenureYears > 3) drivers.push(`long tenure (${tenureYears.toFixed(1)}y) cushions impact`);
    if (input.marketVacancyRate > 0.1) drivers.push('loose market → tenant has alternatives');
    return { probabilityRetained: p, drivers };
  },
};
