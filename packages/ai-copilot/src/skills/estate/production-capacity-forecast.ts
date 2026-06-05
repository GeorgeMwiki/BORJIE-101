/**
 * skill.estate.production_capacity_forecast — project available capacity for 12 months.
 *
 * Uses current asset utilization + seasonal pattern + expiring offtake
 * agreements to estimate next-12-month available capacity. Returns a
 * month-by-month series.
 */

import { z } from 'zod';
import { ToolHandler } from '../../orchestrator/tool-dispatcher.js';

export const ProductionCapacityForecastParamsSchema = z.object({
  siteId: z.string().min(1),
  totalCapacityUnits: z.number().int().positive(),
  currentlyCommitted: z.number().int().nonnegative(),
  offtakesExpiringPerMonth: z.array(z.number().int().nonnegative()).length(12),
  historicalRenewalRate: z.number().min(0).max(1).default(0.75),
  historicalNewOfftakeRate: z.number().min(0).max(1).default(0.6),
  seasonalityBoost: z.array(z.number()).length(12).default([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]),
});
export type ProductionCapacityForecastParams = z.infer<typeof ProductionCapacityForecastParamsSchema>;

export interface ProductionCapacityForecastResult {
  readonly siteId: string;
  readonly months: ReadonlyArray<{
    readonly monthIndex: number;
    readonly expiringCount: number;
    readonly predictedRenewals: number;
    readonly predictedNewOfftakes: number;
    readonly predictedCommitted: number;
    readonly utilizationRate: number;
  }>;
  readonly averageUtilization: number;
  readonly lowestMonthIndex: number;
}

export function forecastProductionCapacity(params: ProductionCapacityForecastParams): ProductionCapacityForecastResult {
  const parsed = ProductionCapacityForecastParamsSchema.parse(params);
  let committed = parsed.currentlyCommitted;
  const series: ProductionCapacityForecastResult['months'][number][] = [];

  for (let i = 0; i < 12; i += 1) {
    const expiring = Math.min(parsed.offtakesExpiringPerMonth[i] ?? 0, committed);
    const renewals = Math.round(expiring * parsed.historicalRenewalRate);
    const released = expiring - renewals;
    committed = committed - released;
    const availableNow = parsed.totalCapacityUnits - committed;
    const newOfftakes = Math.round(
      availableNow * parsed.historicalNewOfftakeRate * (parsed.seasonalityBoost[i] ?? 1)
    );
    const cappedNewOfftakes = Math.min(newOfftakes, availableNow);
    committed = Math.min(parsed.totalCapacityUnits, committed + cappedNewOfftakes);
    const rate = committed / parsed.totalCapacityUnits;
    series.push({
      monthIndex: i,
      expiringCount: expiring,
      predictedRenewals: renewals,
      predictedNewOfftakes: cappedNewOfftakes,
      predictedCommitted: committed,
      utilizationRate: Math.round(rate * 1000) / 1000,
    });
  }

  const averageUtilization =
    series.reduce((sum, m) => sum + m.utilizationRate, 0) / series.length;
  const lowestMonthIndex = series.reduce(
    (lowIdx, m, idx) =>
      m.utilizationRate < (series[lowIdx]?.utilizationRate ?? Infinity) ? idx : lowIdx,
    0
  );

  return {
    siteId: parsed.siteId,
    months: series,
    averageUtilization: Math.round(averageUtilization * 1000) / 1000,
    lowestMonthIndex,
  };
}

export const productionCapacityForecastTool: ToolHandler = {
  name: 'skill.estate.production_capacity_forecast',
  description:
    'Project next-12-month committed production capacity for a site using expiring offtake agreements, historical renewal rate, and seasonality.',
  parameters: {
    type: 'object',
    required: ['siteId', 'totalCapacityUnits', 'currentlyCommitted', 'offtakesExpiringPerMonth'],
    properties: {
      siteId: { type: 'string' },
      totalCapacityUnits: { type: 'number' },
      currentlyCommitted: { type: 'number' },
      offtakesExpiringPerMonth: { type: 'array', items: { type: 'number' } },
      historicalRenewalRate: { type: 'number' },
      historicalNewOfftakeRate: { type: 'number' },
      seasonalityBoost: { type: 'array', items: { type: 'number' } },
    },
  },
  async execute(params) {
    const parsed = ProductionCapacityForecastParamsSchema.safeParse(params);
    if (!parsed.success) return { ok: false, error: parsed.error.message };
    const result = forecastProductionCapacity(parsed.data);
    return {
      ok: true,
      data: result,
      evidenceSummary: `Forecast avg utilization ${Math.round(result.averageUtilization * 100)}%; low in month ${result.lowestMonthIndex + 1}`,
    };
  },
};
