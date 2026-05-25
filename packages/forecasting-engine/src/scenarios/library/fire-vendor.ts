/**
 * fire-vendor — simulate dropping a vendor + onboarding a replacement.
 *
 * Costs: onboarding lag (window of N days with higher no-show rate
 * baseline). Benefits: lower long-run no-show, possibly lower price.
 */

import { z } from 'zod';
import type { Scenario } from '../scenario.js';

export const fireVendorInputs = z.object({
  vendorId: z.string(),
  currentNoShowRate: z.number().min(0).max(1),
  replacementExpectedNoShowRate: z.number().min(0).max(1),
  onboardingDays: z.number().int().min(0).default(14),
  priceDeltaPct: z.number().min(-0.5).max(0.5).default(0),
});

export const fireVendorScenario: Scenario<typeof fireVendorInputs> = {
  name: 'fire-vendor',
  description: 'Drop current vendor + onboard replacement',
  inputs: fireVendorInputs,
  async run(input, ctx) {
    const dayMs = 24 * 60 * 60 * 1000;
    const horizonMonths = Math.max(1, Math.floor(ctx.business.horizonDays / 30));
    // Each no-show roughly costs the owner $50 in lost productivity.
    const monthlyCallVolume = 8;
    const oldMonthlyCost = monthlyCallVolume * input.currentNoShowRate * 50;
    const newMonthlyCost = monthlyCallVolume * input.replacementExpectedNoShowRate * 50;
    const monthlySavings = oldMonthlyCost - newMonthlyCost;

    const onboardingMonths = Math.ceil(input.onboardingDays / 30);
    const noi: { t: number; p10: number; p50: number; p90: number }[] = [];
    for (let m = 1; m <= horizonMonths; m += 1) {
      const inLag = m <= onboardingMonths;
      const base = inLag ? -oldMonthlyCost * 0.5 : monthlySavings;
      noi.push({
        t: ctx.business.nowMs + m * 30 * dayMs,
        p10: base - Math.abs(base) * 0.3,
        p50: base,
        p90: base + Math.abs(base) * 0.3,
      });
    }

    return {
      scenarioName: 'fire-vendor',
      projectedNoi: noi,
      retentionProbability: 0.95, // tenants get faster service eventually
      complianceScore: 0.95,
      intentAlignment: 0.7,
      cashShortfallProbability: 0.05,
      notes: [
        `Old no-show ${(input.currentNoShowRate * 100).toFixed(0)}% → new ${(input.replacementExpectedNoShowRate * 100).toFixed(0)}%`,
        `Monthly savings ${monthlySavings.toFixed(0)}`,
      ],
    };
  },
};
