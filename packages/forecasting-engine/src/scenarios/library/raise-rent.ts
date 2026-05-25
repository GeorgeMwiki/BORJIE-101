/**
 * raise-rent — simulate raising rent X% on a subset of units.
 *
 * For each selected unit:
 *   1. Retention curve → P(retain)
 *   2. If retained → new rent flows into projected NOI
 *   3. If not retained → unit vacant for daysToFill, then re-let
 *      at new rate (also subject to elasticity)
 */

import { z } from 'zod';
import type { Scenario } from '../scenario.js';
import { retentionCurve } from '../../forecasters/causal/retention-curve.js';
import { pricingElasticity } from '../../forecasters/causal/pricing-elasticity.js';
import { fitCashflow, forecastCashflow } from '../../forecasters/time-series/cashflow-forecaster.js';

export const raiseRentInputs = z.object({
  unitIds: z.array(z.string()).min(1),
  pctIncrease: z.number().min(-0.5).max(0.5),
  effectiveDateMs: z.number(),
  microMarketVacancyRate: z.number().min(0).max(1).default(0.05),
  marketDemandIndex: z.number().min(0).max(3).default(1),
});

export type RaiseRentInput = z.infer<typeof raiseRentInputs>;

export const raiseRentScenario: Scenario<typeof raiseRentInputs> = {
  name: 'raise-rent',
  description: 'Raise rent X% on selected units at next renewal',
  inputs: raiseRentInputs,
  async run(input, ctx) {
    const unitSet = new Set(input.unitIds);
    const affectedTenants = ctx.business.tenants.filter((t) => unitSet.has(t.unitId));

    let totalRetainedNoi = 0;
    let totalLostNoi = 0;
    const retentionProbabilities: number[] = [];

    for (const t of affectedTenants) {
      const retention = retentionCurve.apply({
        rentChangePct: input.pctIncrease,
        tenantTenureDays: t.tenureDays,
        marketVacancyRate: input.microMarketVacancyRate,
      });
      retentionProbabilities.push(retention.probabilityRetained);
      const newRent = t.monthlyRent * (1 + input.pctIncrease);
      totalRetainedNoi += retention.probabilityRetained * newRent * 12;

      // For non-retained: re-let after vacancy (use elasticity to set ask)
      const elasticity = pricingElasticity.apply({
        askPriceDelta: input.pctIncrease,
        microMarketDemandIndex: input.marketDemandIndex,
        seasonFactor: 1,
      });
      const expectedDaysVacant = elasticity.expectedDaysToLease;
      const monthsLostPerYear = expectedDaysVacant / 30;
      const yearAdjusted = Math.max(0, 12 - monthsLostPerYear);
      totalLostNoi +=
        (1 - retention.probabilityRetained) * newRent * yearAdjusted;
    }

    const projectedNewNoi = totalRetainedNoi + totalLostNoi;
    const baselineNoi = affectedTenants.reduce(
      (s, t) => s + t.monthlyRent * 12,
      0,
    );

    // Forecast 12 months of cashflow under the new rent roll
    const synth = ctx.business.historicalCashflow.length >= 4
      ? ctx.business.historicalCashflow
      : seedSynthetic(ctx.business.historicalCashflow);
    const model = fitCashflow(synth, { seasonLength: 12 });
    const horizon = Math.max(1, Math.floor(ctx.business.horizonDays / 30));
    const baseForecast = forecastCashflow(model, horizon);
    const uplift = projectedNewNoi / Math.max(1, baselineNoi);
    const projectedNoi = baseForecast.map((b) => ({
      t: b.t,
      p10: b.p10 * uplift,
      p50: b.p50 * uplift,
      p90: b.p90 * uplift,
    }));

    const avgRetention =
      retentionProbabilities.reduce((s, p) => s + p, 0) /
      Math.max(1, retentionProbabilities.length);

    const cashShortfallProbability =
      projectedNoi[0] !== undefined && projectedNoi[0].p10 < 0 ? 0.5 : 0.05;

    return {
      scenarioName: 'raise-rent',
      projectedNoi,
      retentionProbability: avgRetention,
      complianceScore: 1, // rent raises don't move compliance
      intentAlignment:
        ctx.business.ownerIntent.archetype === 'cashflow-first' ? 0.85 : 0.6,
      cashShortfallProbability,
      notes: [
        `Affected ${affectedTenants.length} tenants`,
        `Avg retention p=${avgRetention.toFixed(2)}`,
        `Projected uplift x=${uplift.toFixed(3)}`,
      ],
    };
  },
};

function seedSynthetic(existing: ReadonlyArray<{ t: number; v: number }>) {
  const out = [...existing];
  const dayMs = 24 * 60 * 60 * 1000;
  const lastT = out[out.length - 1]?.t ?? Date.now();
  const baseV = out[out.length - 1]?.v ?? 1000;
  while (out.length < 12) {
    const next = {
      t: lastT - (12 - out.length) * 30 * dayMs,
      v: baseV * (0.95 + Math.sin(out.length) * 0.05),
    };
    out.unshift(next);
  }
  return out;
}
