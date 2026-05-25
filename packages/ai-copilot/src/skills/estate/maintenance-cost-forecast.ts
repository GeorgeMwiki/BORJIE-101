/**
 * skill.estate.maintenance_cost_forecast — predict next-12-month maintenance
 * cost per unit from recent history + component-age curves.
 */

import { z } from 'zod';
import { ToolHandler } from '../../orchestrator/tool-dispatcher.js';

export const ComponentSchema = z.object({
  name: z.string().min(1),
  lastServicedMonthsAgo: z.number().int().nonnegative(),
  expectedLifeMonths: z.number().int().positive(),
  replacementCost: z.number().nonnegative(),
});
export type Component = z.infer<typeof ComponentSchema>;

export const MaintenanceCostForecastParamsSchema = z.object({
  unitId: z.string().min(1),
  averageMonthlyCostLast12m: z.number().nonnegative(),
  components: z.array(ComponentSchema).max(50).default([]),
  inflationRateAnnual: z.number().min(-0.2).max(0.5).default(0.05),
});
export type MaintenanceCostForecastParams = z.infer<
  typeof MaintenanceCostForecastParamsSchema
>;

export interface MaintenanceCostForecastResult {
  readonly unitId: string;
  readonly forecastTotal: number;
  readonly monthly: readonly number[];
  readonly componentAlerts: ReadonlyArray<{ name: string; expectedMonth: number; cost: number }>;
}

export function forecastMaintenanceCost(
  params: MaintenanceCostForecastParams
): MaintenanceCostForecastResult {
  const parsed = MaintenanceCostForecastParamsSchema.parse(params);
  const monthlyInflation = Math.pow(1 + parsed.inflationRateAnnual, 1 / 12) - 1;

  const monthly: number[] = [];
  const alerts: MaintenanceCostForecastResult['componentAlerts'] = [];
  for (let m = 0; m < 12; m += 1) {
    let cost = parsed.averageMonthlyCostLast12m * Math.pow(1 + monthlyInflation, m);
    for (const comp of parsed.components) {
      const monthsUntilEol = comp.expectedLifeMonths - comp.lastServicedMonthsAgo;
      if (monthsUntilEol === m) {
        cost += comp.replacementCost;
        (alerts as unknown as MaintenanceCostForecastResult['componentAlerts'][number][]).push({
          name: comp.name,
          expectedMonth: m,
          cost: comp.replacementCost,
        });
      }
    }
    monthly.push(Math.round(cost));
  }
  const forecastTotal = monthly.reduce((a, b) => a + b, 0);

  return {
    unitId: parsed.unitId,
    forecastTotal,
    monthly,
    componentAlerts: alerts,
  };
}

export const maintenanceCostForecastTool: ToolHandler = {
  name: 'skill.estate.maintenance_cost_forecast',
  description:
    'Forecast next-12-month maintenance cost per unit using recent history + component age curves + inflation.',
  parameters: {
    type: 'object',
    required: ['unitId', 'averageMonthlyCostLast12m'],
    properties: {
      unitId: { type: 'string' },
      averageMonthlyCostLast12m: { type: 'number' },
      components: { type: 'array', items: { type: 'object' } },
      inflationRateAnnual: { type: 'number' },
    },
  },
  async execute(params) {
    const parsed = MaintenanceCostForecastParamsSchema.safeParse(params);
    if (!parsed.success) return { ok: false, error: parsed.error.message };
    const result = forecastMaintenanceCost(parsed.data);
    return {
      ok: true,
      data: result,
      evidenceSummary: `Forecast 12-month maintenance cost ${result.forecastTotal}; ${result.componentAlerts.length} component alert(s)`,
    };
  },
};
