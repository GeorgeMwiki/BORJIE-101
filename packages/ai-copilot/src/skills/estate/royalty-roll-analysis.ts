/**
 * skill.estate.royalty_roll_analysis — spot anomalies in a royalty roll.
 *
 * Flags: under-market prices, unusual outstanding-royalty patterns,
 * consignments without an offtake agreement, duplicated invoices, sudden
 * drops in collection.
 */

import { z } from 'zod';
import { ToolHandler } from '../../orchestrator/tool-dispatcher.js';

export const RoyaltyRollRowSchema = z.object({
  consignmentId: z.string().min(1),
  consignmentLabel: z.string().min(1),
  monthlyRoyalty: z.number().nonnegative(),
  marketRoyalty: z.number().nonnegative().optional(),
  hasOfftake: z.boolean().default(true),
  lastPaymentDaysAgo: z.number().int().nonnegative().default(0),
  outstandingAmount: z.number().nonnegative().default(0),
  outstandingMonths: z.number().int().nonnegative().default(0),
});
export type RoyaltyRollRow = z.infer<typeof RoyaltyRollRowSchema>;

export const RoyaltyRollAnalysisParamsSchema = z.object({
  siteId: z.string().min(1),
  rows: z.array(RoyaltyRollRowSchema).min(1).max(5000),
  underMarketThresholdPct: z.number().min(0).max(1).default(0.1),
});
export type RoyaltyRollAnalysisParams = z.infer<typeof RoyaltyRollAnalysisParamsSchema>;

export interface RoyaltyRollAnomaly {
  readonly consignmentId: string;
  readonly consignmentLabel: string;
  readonly kind:
    | 'under_market_royalty'
    | 'no_active_offtake'
    | 'chronic_outstanding'
    | 'payment_gap'
    | 'zero_royalty';
  readonly severity: 'low' | 'medium' | 'high';
  readonly detail: string;
}

export interface RoyaltyRollAnalysisResult {
  readonly siteId: string;
  readonly totalExpectedMonthly: number;
  readonly totalOutstanding: number;
  readonly outstandingRate: number;
  readonly anomalies: readonly RoyaltyRollAnomaly[];
}

export function analyzeRoyaltyRoll(params: RoyaltyRollAnalysisParams): RoyaltyRollAnalysisResult {
  const parsed = RoyaltyRollAnalysisParamsSchema.parse(params);
  const anomalies: RoyaltyRollAnomaly[] = [];
  let totalExpected = 0;
  let totalOutstanding = 0;

  for (const row of parsed.rows) {
    totalExpected += row.monthlyRoyalty;
    totalOutstanding += row.outstandingAmount;

    if (row.monthlyRoyalty === 0) {
      anomalies.push({
        consignmentId: row.consignmentId,
        consignmentLabel: row.consignmentLabel,
        kind: 'zero_royalty',
        severity: 'high',
        detail: 'Consignment has zero monthly royalty on the roll.',
      });
      continue;
    }
    if (!row.hasOfftake) {
      anomalies.push({
        consignmentId: row.consignmentId,
        consignmentLabel: row.consignmentLabel,
        kind: 'no_active_offtake',
        severity: 'high',
        detail: 'Consignment charged royalty without an active offtake-agreement record.',
      });
    }
    if (
      row.marketRoyalty &&
      row.marketRoyalty > 0 &&
      (row.marketRoyalty - row.monthlyRoyalty) / row.marketRoyalty > parsed.underMarketThresholdPct
    ) {
      anomalies.push({
        consignmentId: row.consignmentId,
        consignmentLabel: row.consignmentLabel,
        kind: 'under_market_royalty',
        severity: 'medium',
        detail: `Royalty ${row.monthlyRoyalty} is > ${Math.round(parsed.underMarketThresholdPct * 100)}% below market ${row.marketRoyalty}.`,
      });
    }
    if (row.outstandingMonths >= 3) {
      anomalies.push({
        consignmentId: row.consignmentId,
        consignmentLabel: row.consignmentLabel,
        kind: 'chronic_outstanding',
        severity: 'high',
        detail: `Outstanding ${row.outstandingMonths} months / ${row.outstandingAmount}.`,
      });
    }
    if (row.lastPaymentDaysAgo > 45 && row.outstandingAmount > 0) {
      anomalies.push({
        consignmentId: row.consignmentId,
        consignmentLabel: row.consignmentLabel,
        kind: 'payment_gap',
        severity: 'medium',
        detail: `No payment in ${row.lastPaymentDaysAgo} days despite outstanding balance.`,
      });
    }
  }

  return {
    siteId: parsed.siteId,
    totalExpectedMonthly: totalExpected,
    totalOutstanding,
    outstandingRate: totalExpected === 0 ? 0 : totalOutstanding / totalExpected,
    anomalies,
  };
}

export const royaltyRollAnalysisTool: ToolHandler = {
  name: 'skill.estate.royalty_roll_analysis',
  description:
    'Analyse a royalty roll for anomalies: under-market royalties, consignments without an offtake agreement, chronic outstanding royalties, payment gaps.',
  parameters: {
    type: 'object',
    required: ['siteId', 'rows'],
    properties: {
      siteId: { type: 'string' },
      rows: { type: 'array', items: { type: 'object' } },
      underMarketThresholdPct: { type: 'number' },
    },
  },
  async execute(params) {
    const parsed = RoyaltyRollAnalysisParamsSchema.safeParse(params);
    if (!parsed.success) return { ok: false, error: parsed.error.message };
    const result = analyzeRoyaltyRoll(parsed.data);
    return {
      ok: true,
      data: result,
      evidenceSummary: `Found ${result.anomalies.length} anomaly(ies); outstanding rate ${Math.round(result.outstandingRate * 100)}%`,
    };
  },
};
