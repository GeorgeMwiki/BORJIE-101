/**
 * acquire-property — simulate acquiring a new property + units.
 *
 * Models NOI uplift, cash drain from purchase, and increased
 * maintenance arrival rate. Compliance unchanged in v1.
 */

import { z } from 'zod';
import type { Scenario } from '../scenario.js';

export const acquirePropertyInputs = z.object({
  unitCount: z.number().int().min(1),
  expectedMonthlyRentPerUnit: z.number().min(0),
  purchasePrice: z.number().min(0),
  financedPct: z.number().min(0).max(1).default(0.7),
  expectedOccupancy: z.number().min(0).max(1).default(0.9),
});

export const acquirePropertyScenario: Scenario<typeof acquirePropertyInputs> = {
  name: 'acquire-property',
  description: 'Acquire a new property + integrate into portfolio',
  inputs: acquirePropertyInputs,
  async run(input, ctx) {
    const monthlyRentRoll =
      input.unitCount * input.expectedMonthlyRentPerUnit * input.expectedOccupancy;
    const annualNoi = monthlyRentRoll * 12 * 0.65; // 65% margin after opex
    const downPayment = input.purchasePrice * (1 - input.financedPct);

    const dayMs = 24 * 60 * 60 * 1000;
    const horizonMonths = Math.max(1, Math.floor(ctx.business.horizonDays / 30));
    const noi: { t: number; p10: number; p50: number; p90: number }[] = [];
    for (let m = 1; m <= horizonMonths; m += 1) {
      const monthly = annualNoi / 12;
      noi.push({
        t: ctx.business.nowMs + m * 30 * dayMs,
        p10: monthly * 0.7,
        p50: monthly,
        p90: monthly * 1.2,
      });
    }

    const shortfallRisk =
      downPayment > ctx.business.cashBalance ? 0.85 : 0.15;

    return {
      scenarioName: 'acquire-property',
      projectedNoi: noi,
      retentionProbability: 0.9, // new tenants stable for a while
      complianceScore: 0.95,
      intentAlignment:
        ctx.business.ownerIntent.archetype === 'growth' ? 0.9 : 0.5,
      cashShortfallProbability: shortfallRisk,
      notes: [
        `Down payment ${downPayment.toFixed(0)} vs cash ${ctx.business.cashBalance.toFixed(0)}`,
        `Annual NOI uplift ${annualNoi.toFixed(0)}`,
      ],
    };
  },
};
