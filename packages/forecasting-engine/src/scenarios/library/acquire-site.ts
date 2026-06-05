/**
 * acquire-site — simulate acquiring a new mining site + units.
 *
 * Models net-margin uplift, cash drain from purchase, and increased
 * maintenance arrival rate. Compliance unchanged in v1.
 */

import { z } from 'zod';
import type { Scenario } from '../scenario.js';

export const acquireSiteInputs = z.object({
  unitCount: z.number().int().min(1),
  expectedMonthlyRoyaltyPerUnit: z.number().min(0),
  purchasePrice: z.number().min(0),
  financedPct: z.number().min(0).max(1).default(0.7),
  expectedUtilisation: z.number().min(0).max(1).default(0.9),
});

export const acquireSiteScenario: Scenario<typeof acquireSiteInputs> = {
  name: 'acquire-site',
  description: 'Acquire a new mining site + integrate into the estate',
  inputs: acquireSiteInputs,
  async run(input, ctx) {
    const monthlyRoyaltyRoll =
      input.unitCount * input.expectedMonthlyRoyaltyPerUnit * input.expectedUtilisation;
    const annualMargin = monthlyRoyaltyRoll * 12 * 0.65; // 65% margin after opex
    const downPayment = input.purchasePrice * (1 - input.financedPct);

    const dayMs = 24 * 60 * 60 * 1000;
    const horizonMonths = Math.max(1, Math.floor(ctx.business.horizonDays / 30));
    const margin: { t: number; p10: number; p50: number; p90: number }[] = [];
    for (let m = 1; m <= horizonMonths; m += 1) {
      const monthly = annualMargin / 12;
      margin.push({
        t: ctx.business.nowMs + m * 30 * dayMs,
        p10: monthly * 0.7,
        p50: monthly,
        p90: monthly * 1.2,
      });
    }

    const shortfallRisk =
      downPayment > ctx.business.cashBalance ? 0.85 : 0.15;

    return {
      scenarioName: 'acquire-site',
      projectedNetMargin: margin,
      retentionProbability: 0.9, // new counterparties stable for a while
      complianceScore: 0.95,
      intentAlignment:
        ctx.business.ownerIntent.archetype === 'growth' ? 0.9 : 0.5,
      cashShortfallProbability: shortfallRisk,
      notes: [
        `Down payment ${downPayment.toFixed(0)} vs cash ${ctx.business.cashBalance.toFixed(0)}`,
        `Annual net-margin uplift ${annualMargin.toFixed(0)}`,
      ],
    };
  },
};

/** @deprecated Use {@link acquireSiteScenario}. */
export const acquirePropertyScenario = acquireSiteScenario;
