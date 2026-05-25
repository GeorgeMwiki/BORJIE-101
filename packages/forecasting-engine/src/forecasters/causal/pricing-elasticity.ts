/**
 * PricingElasticity — P(lease signed in 30 days | ask delta vs median).
 *
 * Hand-coded log-linear curve. Higher ask vs median → lower
 * conversion. Season factor models high/low season effects.
 *
 * Monotonicity: P(signed) is non-increasing in askPriceDelta.
 */

import type { CausalModel } from './causal-model.js';

export interface PricingInput {
  readonly askPriceDelta: number; // (ask - median) / median
  readonly microMarketDemandIndex: number; // 1 = average
  readonly seasonFactor: number; // 1 = neutral, >1 high season
}

export interface PricingOutput {
  readonly probabilitySigned: number;
  readonly expectedDaysToLease: number;
  readonly drivers: ReadonlyArray<string>;
}

export const pricingElasticity: CausalModel<PricingInput, PricingOutput> = {
  meta: {
    id: 'pricing.elasticity.v1',
    description:
      'Probability a unit signs in 30d, and expected days-to-lease, given price vs market.',
    inputName: 'askPriceDelta',
    outputName: 'probabilitySigned',
    monotonicity: 'decreasing',
    domain: { min: -0.3, max: 0.5 },
    source: 'hand-coded',
  },
  apply(input) {
    // Base prob at parity is ~0.6, drops sharply above market, climbs below.
    const elasticity = -2.2; // negative -> higher price reduces conversion
    const base = 0.6;
    const demandLift = (input.microMarketDemandIndex - 1) * 0.15;
    const seasonLift = (input.seasonFactor - 1) * 0.1;
    const raw = base + elasticity * input.askPriceDelta + demandLift + seasonLift;
    const p = Math.max(0.02, Math.min(0.98, raw));
    const baseDays = 30;
    const expectedDays = baseDays / Math.max(0.1, p);
    const drivers: string[] = [];
    if (input.askPriceDelta > 0.05) drivers.push(`asking ${(input.askPriceDelta * 100).toFixed(1)}% above median`);
    if (input.microMarketDemandIndex < 0.9) drivers.push('soft demand');
    if (input.seasonFactor < 0.95) drivers.push('off-season');
    return { probabilitySigned: p, expectedDaysToLease: expectedDays, drivers };
  },
};
