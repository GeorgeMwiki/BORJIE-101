/**
 * raise-royalty — simulate raising the royalty / payment rate X% on a
 * subset of units.
 *
 * For each selected unit:
 *   1. Retention curve → P(retain)
 *   2. If retained → new royalty flows into projected net margin
 *   3. If not retained → unit idle for daysToFill, then re-contracted
 *      at new rate (also subject to elasticity)
 */

import { z } from 'zod';
import type { Scenario } from '../scenario.js';
import { retentionCurve } from '../../forecasters/causal/retention-curve.js';
import { pricingElasticity } from '../../forecasters/causal/pricing-elasticity.js';
import { fitCashflow, forecastCashflow } from '../../forecasters/time-series/cashflow-forecaster.js';

export const raiseRoyaltyInputs = z.object({
  unitIds: z.array(z.string()).min(1),
  pctIncrease: z.number().min(-0.5).max(0.5),
  effectiveDateMs: z.number(),
  microMarketAvailableCapacityRate: z.number().min(0).max(1).default(0.05),
  marketDemandIndex: z.number().min(0).max(3).default(1),
});

export type RaiseRoyaltyInput = z.infer<typeof raiseRoyaltyInputs>;

export const raiseRoyaltyScenario: Scenario<typeof raiseRoyaltyInputs> = {
  name: 'raise-royalty',
  description: 'Raise royalty X% on selected units at next renewal',
  inputs: raiseRoyaltyInputs,
  async run(input, ctx) {
    const unitSet = new Set(input.unitIds);
    const affectedCounterparties = ctx.business.counterparties.filter((c) => unitSet.has(c.unitId));

    let totalRetainedMargin = 0;
    let totalLostMargin = 0;
    const retentionProbabilities: number[] = [];

    for (const c of affectedCounterparties) {
      const retention = retentionCurve.apply({
        royaltyChangePct: input.pctIncrease,
        counterpartyTenureDays: c.tenureDays,
        marketAvailableCapacityRate: input.microMarketAvailableCapacityRate,
      });
      retentionProbabilities.push(retention.probabilityRetained);
      const newRoyalty = c.monthlyRoyalty * (1 + input.pctIncrease);
      totalRetainedMargin += retention.probabilityRetained * newRoyalty * 12;

      // For non-retained: re-contract after idle period (use elasticity to set ask)
      const elasticity = pricingElasticity.apply({
        askPriceDelta: input.pctIncrease,
        microMarketDemandIndex: input.marketDemandIndex,
        seasonFactor: 1,
      });
      const expectedDaysIdle = elasticity.expectedDaysToContract;
      const monthsLostPerYear = expectedDaysIdle / 30;
      const yearAdjusted = Math.max(0, 12 - monthsLostPerYear);
      totalLostMargin +=
        (1 - retention.probabilityRetained) * newRoyalty * yearAdjusted;
    }

    const projectedNewMargin = totalRetainedMargin + totalLostMargin;
    const baselineMargin = affectedCounterparties.reduce(
      (s, c) => s + c.monthlyRoyalty * 12,
      0,
    );

    // Forecast 12 months of cashflow under the new royalty roll
    const synth = ctx.business.historicalCashflow.length >= 4
      ? ctx.business.historicalCashflow
      : seedSynthetic(ctx.business.historicalCashflow);
    const model = fitCashflow(synth, { seasonLength: 12 });
    const horizon = Math.max(1, Math.floor(ctx.business.horizonDays / 30));
    const baseForecast = forecastCashflow(model, horizon);
    const uplift = projectedNewMargin / Math.max(1, baselineMargin);
    const projectedNetMargin = baseForecast.map((b) => ({
      t: b.t,
      p10: b.p10 * uplift,
      p50: b.p50 * uplift,
      p90: b.p90 * uplift,
    }));

    const avgRetention =
      retentionProbabilities.reduce((s, p) => s + p, 0) /
      Math.max(1, retentionProbabilities.length);

    const cashShortfallProbability =
      projectedNetMargin[0] !== undefined && projectedNetMargin[0].p10 < 0 ? 0.5 : 0.05;

    return {
      scenarioName: 'raise-royalty',
      projectedNetMargin,
      retentionProbability: avgRetention,
      complianceScore: 1, // royalty raises don't move compliance
      intentAlignment:
        ctx.business.ownerIntent.archetype === 'cashflow-first' ? 0.85 : 0.6,
      cashShortfallProbability,
      notes: [
        `Affected ${affectedCounterparties.length} counterparties`,
        `Avg retention p=${avgRetention.toFixed(2)}`,
        `Projected uplift x=${uplift.toFixed(3)}`,
      ],
    };
  },
};

/** @deprecated Use {@link raiseRoyaltyScenario}. */
export const raiseRentScenario = raiseRoyaltyScenario;

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
