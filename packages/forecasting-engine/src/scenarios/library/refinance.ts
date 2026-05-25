/**
 * refinance — simulate refinancing existing debt at a new rate.
 *
 * Reduces monthly debt service, but pays origination costs upfront.
 */

import { z } from 'zod';
import type { Scenario } from '../scenario.js';

export const refinanceInputs = z.object({
  outstandingPrincipal: z.number().min(0),
  oldRateApr: z.number().min(0).max(1),
  newRateApr: z.number().min(0).max(1),
  remainingTermMonths: z.number().int().min(1),
  originationFeePct: z.number().min(0).max(0.1).default(0.015),
});

export const refinanceScenario: Scenario<typeof refinanceInputs> = {
  name: 'refinance',
  description: 'Refinance existing debt at a new rate',
  inputs: refinanceInputs,
  async run(input, ctx) {
    const monthlyOld = monthlyPayment(input.outstandingPrincipal, input.oldRateApr, input.remainingTermMonths);
    const monthlyNew = monthlyPayment(input.outstandingPrincipal, input.newRateApr, input.remainingTermMonths);
    const savingsPerMonth = monthlyOld - monthlyNew;
    const origFee = input.outstandingPrincipal * input.originationFeePct;

    const dayMs = 24 * 60 * 60 * 1000;
    const horizonMonths = Math.max(1, Math.floor(ctx.business.horizonDays / 30));
    const noi: { t: number; p10: number; p50: number; p90: number }[] = [];
    for (let m = 1; m <= horizonMonths; m += 1) {
      const p50 = savingsPerMonth - (m === 1 ? origFee : 0);
      noi.push({
        t: ctx.business.nowMs + m * 30 * dayMs,
        p10: p50 - Math.abs(p50) * 0.2,
        p50,
        p90: p50 + Math.abs(p50) * 0.2,
      });
    }

    const breakEvenMonths = origFee / Math.max(0.01, savingsPerMonth);
    const shortfall = origFee > ctx.business.cashBalance ? 0.7 : 0.1;

    return {
      scenarioName: 'refinance',
      projectedNoi: noi,
      retentionProbability: 1, // tenants unaffected
      complianceScore: 1,
      intentAlignment:
        ctx.business.ownerIntent.archetype === 'cashflow-first' ? 0.9 : 0.7,
      cashShortfallProbability: shortfall,
      notes: [
        `Monthly savings ${savingsPerMonth.toFixed(0)}`,
        `Break-even ${breakEvenMonths.toFixed(1)} months`,
      ],
    };
  },
};

function monthlyPayment(P: number, apr: number, n: number): number {
  if (apr === 0) return P / n;
  const r = apr / 12;
  return (P * r) / (1 - Math.pow(1 + r, -n));
}
