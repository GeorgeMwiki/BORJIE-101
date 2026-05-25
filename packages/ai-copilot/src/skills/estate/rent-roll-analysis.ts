/**
 * skill.estate.rent_roll_analysis — spot anomalies in a rent roll.
 *
 * Flags: under-market rents, unusual arrears patterns, units without leases,
 * duplicated invoices, sudden drops in collection.
 */

import { z } from 'zod';
import { ToolHandler } from '../../orchestrator/tool-dispatcher.js';

export const RentRollRowSchema = z.object({
  unitId: z.string().min(1),
  unitLabel: z.string().min(1),
  monthlyRent: z.number().nonnegative(),
  marketRent: z.number().nonnegative().optional(),
  hasLease: z.boolean().default(true),
  lastPaymentDaysAgo: z.number().int().nonnegative().default(0),
  arrearsAmount: z.number().nonnegative().default(0),
  arrearsMonths: z.number().int().nonnegative().default(0),
});
export type RentRollRow = z.infer<typeof RentRollRowSchema>;

export const RentRollAnalysisParamsSchema = z.object({
  propertyId: z.string().min(1),
  rows: z.array(RentRollRowSchema).min(1).max(5000),
  underMarketThresholdPct: z.number().min(0).max(1).default(0.1),
});
export type RentRollAnalysisParams = z.infer<typeof RentRollAnalysisParamsSchema>;

export interface RentRollAnomaly {
  readonly unitId: string;
  readonly unitLabel: string;
  readonly kind:
    | 'under_market_rent'
    | 'no_active_lease'
    | 'chronic_arrears'
    | 'payment_gap'
    | 'zero_rent';
  readonly severity: 'low' | 'medium' | 'high';
  readonly detail: string;
}

export interface RentRollAnalysisResult {
  readonly propertyId: string;
  readonly totalExpectedMonthly: number;
  readonly totalArrears: number;
  readonly arrearsRate: number;
  readonly anomalies: readonly RentRollAnomaly[];
}

export function analyzeRentRoll(params: RentRollAnalysisParams): RentRollAnalysisResult {
  const parsed = RentRollAnalysisParamsSchema.parse(params);
  const anomalies: RentRollAnomaly[] = [];
  let totalExpected = 0;
  let totalArrears = 0;

  for (const row of parsed.rows) {
    totalExpected += row.monthlyRent;
    totalArrears += row.arrearsAmount;

    if (row.monthlyRent === 0) {
      anomalies.push({
        unitId: row.unitId,
        unitLabel: row.unitLabel,
        kind: 'zero_rent',
        severity: 'high',
        detail: 'Unit has zero monthly rent on the roll.',
      });
      continue;
    }
    if (!row.hasLease) {
      anomalies.push({
        unitId: row.unitId,
        unitLabel: row.unitLabel,
        kind: 'no_active_lease',
        severity: 'high',
        detail: 'Unit charged rent without an active lease record.',
      });
    }
    if (
      row.marketRent &&
      row.marketRent > 0 &&
      (row.marketRent - row.monthlyRent) / row.marketRent > parsed.underMarketThresholdPct
    ) {
      anomalies.push({
        unitId: row.unitId,
        unitLabel: row.unitLabel,
        kind: 'under_market_rent',
        severity: 'medium',
        detail: `Rent ${row.monthlyRent} is > ${Math.round(parsed.underMarketThresholdPct * 100)}% below market ${row.marketRent}.`,
      });
    }
    if (row.arrearsMonths >= 3) {
      anomalies.push({
        unitId: row.unitId,
        unitLabel: row.unitLabel,
        kind: 'chronic_arrears',
        severity: 'high',
        detail: `In arrears ${row.arrearsMonths} months / ${row.arrearsAmount}.`,
      });
    }
    if (row.lastPaymentDaysAgo > 45 && row.arrearsAmount > 0) {
      anomalies.push({
        unitId: row.unitId,
        unitLabel: row.unitLabel,
        kind: 'payment_gap',
        severity: 'medium',
        detail: `No payment in ${row.lastPaymentDaysAgo} days despite outstanding balance.`,
      });
    }
  }

  return {
    propertyId: parsed.propertyId,
    totalExpectedMonthly: totalExpected,
    totalArrears,
    arrearsRate: totalExpected === 0 ? 0 : totalArrears / totalExpected,
    anomalies,
  };
}

export const rentRollAnalysisTool: ToolHandler = {
  name: 'skill.estate.rent_roll_analysis',
  description:
    'Analyse a rent roll for anomalies: under-market rents, units without leases, chronic arrears, payment gaps.',
  parameters: {
    type: 'object',
    required: ['propertyId', 'rows'],
    properties: {
      propertyId: { type: 'string' },
      rows: { type: 'array', items: { type: 'object' } },
      underMarketThresholdPct: { type: 'number' },
    },
  },
  async execute(params) {
    const parsed = RentRollAnalysisParamsSchema.safeParse(params);
    if (!parsed.success) return { ok: false, error: parsed.error.message };
    const result = analyzeRentRoll(parsed.data);
    return {
      ok: true,
      data: result,
      evidenceSummary: `Found ${result.anomalies.length} anomaly(ies); arrears rate ${Math.round(result.arrearsRate * 100)}%`,
    };
  },
};
