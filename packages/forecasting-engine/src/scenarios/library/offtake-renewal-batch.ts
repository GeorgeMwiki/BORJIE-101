/**
 * offtake-renewal-batch — handle a batch of offtakes coming up for renewal.
 *
 * Inputs: list of offtake ids + per-offtake proposed royalty action
 * (hold, raise pct). For each, compute retention. Aggregate cashflow.
 */

import { z } from 'zod';
import type { Scenario } from '../scenario.js';
import { retentionCurve } from '../../forecasters/causal/retention-curve.js';

export const offtakeRenewalBatchInputs = z.object({
  decisions: z.array(
    z.object({
      counterpartyId: z.string(),
      pctIncrease: z.number().min(-0.2).max(0.5),
    }),
  ),
  microMarketAvailableCapacityRate: z.number().min(0).max(1).default(0.05),
});

export const offtakeRenewalBatchScenario: Scenario<typeof offtakeRenewalBatchInputs> = {
  name: 'offtake-renewal-batch',
  description: 'Process a batch of upcoming offtake renewals with per-offtake actions',
  inputs: offtakeRenewalBatchInputs,
  async run(input, ctx) {
    let totalNewMonthly = 0;
    let totalBaselineMonthly = 0;
    const retentions: number[] = [];

    for (const d of input.decisions) {
      const counterparty = ctx.business.counterparties.find(
        (c) => c.counterpartyId === d.counterpartyId,
      );
      if (!counterparty) continue;
      totalBaselineMonthly += counterparty.monthlyRoyalty;
      const ret = retentionCurve.apply({
        royaltyChangePct: d.pctIncrease,
        counterpartyTenureDays: counterparty.tenureDays,
        marketAvailableCapacityRate: input.microMarketAvailableCapacityRate,
      });
      retentions.push(ret.probabilityRetained);
      const newRoyalty = counterparty.monthlyRoyalty * (1 + d.pctIncrease);
      totalNewMonthly += ret.probabilityRetained * newRoyalty;
    }

    const dayMs = 24 * 60 * 60 * 1000;
    const horizonMonths = Math.max(1, Math.floor(ctx.business.horizonDays / 30));
    const margin: { t: number; p10: number; p50: number; p90: number }[] = [];
    for (let m = 1; m <= horizonMonths; m += 1) {
      const p50 = totalNewMonthly;
      margin.push({
        t: ctx.business.nowMs + m * 30 * dayMs,
        p10: p50 * 0.85,
        p50,
        p90: p50 * 1.05,
      });
    }

    const avgRetention =
      retentions.reduce((s, p) => s + p, 0) / Math.max(1, retentions.length);

    return {
      scenarioName: 'offtake-renewal-batch',
      projectedNetMargin: margin,
      retentionProbability: avgRetention,
      complianceScore: 1,
      intentAlignment:
        ctx.business.ownerIntent.archetype === 'cashflow-first' ? 0.8 : 0.75,
      cashShortfallProbability: 0.05,
      notes: [
        `Decisions=${input.decisions.length}`,
        `Baseline monthly ${totalBaselineMonthly.toFixed(0)} → new expected ${totalNewMonthly.toFixed(0)}`,
        `Avg retention ${avgRetention.toFixed(2)}`,
      ],
    };
  },
};

/** @deprecated Use {@link offtakeRenewalBatchScenario}. */
export const leaseRenewalBatchScenario = offtakeRenewalBatchScenario;
