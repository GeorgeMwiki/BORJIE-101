/**
 * water-main-crisis — cascade simulation.
 *
 * Single failure → cost impact across N units. Models:
 *   - direct repair cost
 *   - rent abatement for affected tenants
 *   - elevated short-term move-out risk
 *   - vendor queue saturation
 */

import { z } from 'zod';
import type { Scenario } from '../scenario.js';
import { simulateMaintenanceQueue } from '../../forecasters/discrete-event/maintenance-queue-sim.js';

export const waterMainCrisisInputs = z.object({
  affectedUnitIds: z.array(z.string()).min(1),
  repairCost: z.number().min(0),
  repairDays: z.number().int().min(1),
  abatementPctOfRent: z.number().min(0).max(1).default(0.5),
  vendorCount: z.number().int().min(1).default(2),
});

export const waterMainCrisisScenario: Scenario<typeof waterMainCrisisInputs> = {
  name: 'water-main-crisis',
  description: 'Cascade impact of a water-main failure',
  inputs: waterMainCrisisInputs,
  async run(input, ctx) {
    const affected = new Set(input.affectedUnitIds);
    const affectedTenants = ctx.business.tenants.filter((t) => affected.has(t.unitId));
    const totalRent = affectedTenants.reduce((s, t) => s + t.monthlyRent, 0);
    const abatement = totalRent * (input.repairDays / 30) * input.abatementPctOfRent;

    const queue = simulateMaintenanceQueue({
      arrivalRatePerDay: affectedTenants.length * 0.5,
      serviceRatePerDay: 0.8,
      vendorCount: input.vendorCount,
      vendorNoShowRate: 0.15,
      horizonDays: Math.max(7, input.repairDays + 7),
      seed: ctx.seed,
    });

    const dayMs = 24 * 60 * 60 * 1000;
    const horizonMonths = Math.max(1, Math.floor(ctx.business.horizonDays / 30));
    const noi: { t: number; p10: number; p50: number; p90: number }[] = [];
    for (let m = 1; m <= horizonMonths; m += 1) {
      const impact = m === 1 ? -(input.repairCost + abatement) : 0;
      noi.push({
        t: ctx.business.nowMs + m * 30 * dayMs,
        p10: impact - Math.abs(impact) * 0.4,
        p50: impact,
        p90: impact + Math.abs(impact) * 0.2,
      });
    }

    return {
      scenarioName: 'water-main-crisis',
      projectedNoi: noi,
      retentionProbability: Math.max(0.5, 0.95 - queue.meanWaitDays * 0.05),
      complianceScore: 0.85, // habitability concerns
      intentAlignment: 0.3, // crisis is never on-plan
      cashShortfallProbability:
        input.repairCost + abatement > ctx.business.cashBalance ? 0.8 : 0.2,
      notes: [
        `Repair ${input.repairCost.toFixed(0)} + abatement ${abatement.toFixed(0)}`,
        `Mean wait ${queue.meanWaitDays.toFixed(1)} days, p95 ${queue.p95WaitDays.toFixed(1)}`,
      ],
    };
  },
};
