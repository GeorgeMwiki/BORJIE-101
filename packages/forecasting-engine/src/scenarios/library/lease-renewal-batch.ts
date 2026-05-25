/**
 * lease-renewal-batch — handle a batch of leases coming up for renewal.
 *
 * Inputs: list of lease ids + per-lease proposed rent action (hold,
 * raise pct). For each, compute retention. Aggregate cashflow.
 */

import { z } from 'zod';
import type { Scenario } from '../scenario.js';
import { retentionCurve } from '../../forecasters/causal/retention-curve.js';

export const leaseRenewalBatchInputs = z.object({
  decisions: z.array(
    z.object({
      tenantId: z.string(),
      pctIncrease: z.number().min(-0.2).max(0.5),
    }),
  ),
  microMarketVacancyRate: z.number().min(0).max(1).default(0.05),
});

export const leaseRenewalBatchScenario: Scenario<typeof leaseRenewalBatchInputs> = {
  name: 'lease-renewal-batch',
  description: 'Process a batch of upcoming lease renewals with per-lease actions',
  inputs: leaseRenewalBatchInputs,
  async run(input, ctx) {
    let totalNewMonthly = 0;
    let totalBaselineMonthly = 0;
    const retentions: number[] = [];

    for (const d of input.decisions) {
      const tenant = ctx.business.tenants.find((t) => t.tenantId === d.tenantId);
      if (!tenant) continue;
      totalBaselineMonthly += tenant.monthlyRent;
      const ret = retentionCurve.apply({
        rentChangePct: d.pctIncrease,
        tenantTenureDays: tenant.tenureDays,
        marketVacancyRate: input.microMarketVacancyRate,
      });
      retentions.push(ret.probabilityRetained);
      const newRent = tenant.monthlyRent * (1 + d.pctIncrease);
      totalNewMonthly += ret.probabilityRetained * newRent;
    }

    const dayMs = 24 * 60 * 60 * 1000;
    const horizonMonths = Math.max(1, Math.floor(ctx.business.horizonDays / 30));
    const noi: { t: number; p10: number; p50: number; p90: number }[] = [];
    for (let m = 1; m <= horizonMonths; m += 1) {
      const p50 = totalNewMonthly;
      noi.push({
        t: ctx.business.nowMs + m * 30 * dayMs,
        p10: p50 * 0.85,
        p50,
        p90: p50 * 1.05,
      });
    }

    const avgRetention =
      retentions.reduce((s, p) => s + p, 0) / Math.max(1, retentions.length);

    return {
      scenarioName: 'lease-renewal-batch',
      projectedNoi: noi,
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
