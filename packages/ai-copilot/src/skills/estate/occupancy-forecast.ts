/**
 * skill.estate.occupancy_forecast — project vacancy rates for 12 months.
 *
 * Uses current occupancy + seasonal pattern + expiring leases to estimate
 * next-12-month vacancy. Returns month-by-month series.
 */

import { z } from 'zod';
import { ToolHandler } from '../../orchestrator/tool-dispatcher.js';

export const OccupancyForecastParamsSchema = z.object({
  propertyId: z.string().min(1),
  totalUnits: z.number().int().positive(),
  currentlyOccupied: z.number().int().nonnegative(),
  leasesExpiringPerMonth: z.array(z.number().int().nonnegative()).length(12),
  historicalRenewalRate: z.number().min(0).max(1).default(0.75),
  historicalNewLeaseRate: z.number().min(0).max(1).default(0.6),
  seasonalityBoost: z.array(z.number()).length(12).default([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]),
});
export type OccupancyForecastParams = z.infer<typeof OccupancyForecastParamsSchema>;

export interface OccupancyForecastResult {
  readonly propertyId: string;
  readonly months: ReadonlyArray<{
    readonly monthIndex: number;
    readonly expiringCount: number;
    readonly predictedRenewals: number;
    readonly predictedNewLeases: number;
    readonly predictedOccupied: number;
    readonly occupancyRate: number;
  }>;
  readonly averageOccupancy: number;
  readonly lowestMonthIndex: number;
}

export function forecastOccupancy(params: OccupancyForecastParams): OccupancyForecastResult {
  const parsed = OccupancyForecastParamsSchema.parse(params);
  let occupied = parsed.currentlyOccupied;
  const series: OccupancyForecastResult['months'][number][] = [];

  for (let i = 0; i < 12; i += 1) {
    const expiring = Math.min(parsed.leasesExpiringPerMonth[i], occupied);
    const renewals = Math.round(expiring * parsed.historicalRenewalRate);
    const vacated = expiring - renewals;
    occupied = occupied - vacated;
    const vacancyNow = parsed.totalUnits - occupied;
    const newLeases = Math.round(
      vacancyNow * parsed.historicalNewLeaseRate * (parsed.seasonalityBoost[i] ?? 1)
    );
    const cappedNewLeases = Math.min(newLeases, vacancyNow);
    occupied = Math.min(parsed.totalUnits, occupied + cappedNewLeases);
    const rate = occupied / parsed.totalUnits;
    series.push({
      monthIndex: i,
      expiringCount: expiring,
      predictedRenewals: renewals,
      predictedNewLeases: cappedNewLeases,
      predictedOccupied: occupied,
      occupancyRate: Math.round(rate * 1000) / 1000,
    });
  }

  const averageOccupancy =
    series.reduce((sum, m) => sum + m.occupancyRate, 0) / series.length;
  const lowestMonthIndex = series.reduce(
    (lowIdx, m, idx) =>
      m.occupancyRate < series[lowIdx].occupancyRate ? idx : lowIdx,
    0
  );

  return {
    propertyId: parsed.propertyId,
    months: series,
    averageOccupancy: Math.round(averageOccupancy * 1000) / 1000,
    lowestMonthIndex,
  };
}

export const occupancyForecastTool: ToolHandler = {
  name: 'skill.estate.occupancy_forecast',
  description:
    'Project next-12-month occupancy for a property using expiring leases, historical renewal rate, and seasonality.',
  parameters: {
    type: 'object',
    required: ['propertyId', 'totalUnits', 'currentlyOccupied', 'leasesExpiringPerMonth'],
    properties: {
      propertyId: { type: 'string' },
      totalUnits: { type: 'number' },
      currentlyOccupied: { type: 'number' },
      leasesExpiringPerMonth: { type: 'array', items: { type: 'number' } },
      historicalRenewalRate: { type: 'number' },
      historicalNewLeaseRate: { type: 'number' },
      seasonalityBoost: { type: 'array', items: { type: 'number' } },
    },
  },
  async execute(params) {
    const parsed = OccupancyForecastParamsSchema.safeParse(params);
    if (!parsed.success) return { ok: false, error: parsed.error.message };
    const result = forecastOccupancy(parsed.data);
    return {
      ok: true,
      data: result,
      evidenceSummary: `Forecast avg occupancy ${Math.round(result.averageOccupancy * 100)}%; low in month ${result.lowestMonthIndex + 1}`,
    };
  },
};
