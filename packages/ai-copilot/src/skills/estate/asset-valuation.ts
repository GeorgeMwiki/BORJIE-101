/**
 * skill.estate.asset_valuation — comparable-based valuation of a mineral asset.
 *
 * Deterministic heuristic: weighted median of recent comparable asset sales +
 * adjustments for ore grade, asset age, condition. Returns a range with
 * confidence and the comparables that drove it.
 */

import { z } from 'zod';
import { ToolHandler } from '../../orchestrator/tool-dispatcher.js';

export const ComparableSchema = z.object({
  id: z.string().min(1),
  pricePerTonne: z.number().positive(),
  oreGradeGpt: z.number().positive(),
  ageYears: z.number().int().nonnegative(),
  condition: z.enum(['excellent', 'good', 'fair', 'poor']).default('good'),
  distanceKm: z.number().nonnegative(),
  soldMonthsAgo: z.number().int().nonnegative(),
});
export type Comparable = z.infer<typeof ComparableSchema>;

export const AssetValuationParamsSchema = z.object({
  assetId: z.string().min(1),
  oreGradeGpt: z.number().positive(),
  reserveTonnes: z.number().positive(),
  ageYears: z.number().int().nonnegative(),
  condition: z.enum(['excellent', 'good', 'fair', 'poor']).default('good'),
  comparables: z.array(ComparableSchema).min(1).max(30),
  // Follow-up KI-005 (#33): caller should pass tenant.defaultCurrency resolved
  //   from the country plugin. Any ISO-4217 code is accepted today; the
  //   USD fallback is neutral (export/offtake). See Docs/KNOWN_ISSUES.md#ki-005.
  currency: z.string().length(3).default('USD'),
});
export type AssetValuationParams = z.infer<typeof AssetValuationParamsSchema>;

export interface AssetValuationResult {
  readonly assetId: string;
  readonly estimatePerTonne: number;
  readonly estimateTotal: number;
  readonly rangeLow: number;
  readonly rangeHigh: number;
  readonly confidence: 'low' | 'medium' | 'high';
  readonly comparablesUsed: ReadonlyArray<{ id: string; weight: number }>;
  readonly currency: AssetValuationParams['currency'];
}

const CONDITION_ADJUSTMENT: Record<Comparable['condition'], number> = {
  excellent: 1.1,
  good: 1.0,
  fair: 0.9,
  poor: 0.75,
};

export function valueAsset(params: AssetValuationParams): AssetValuationResult {
  const parsed = AssetValuationParamsSchema.parse(params);

  // Weight each comparable by (1 / (1 + distanceKm)) * (1 / (1 + monthsAgo/6)).
  const weighted = parsed.comparables.map((c) => {
    const geoWeight = 1 / (1 + c.distanceKm * 0.5);
    const recencyWeight = 1 / (1 + c.soldMonthsAgo / 6);
    const gradeMatch = Math.abs(c.oreGradeGpt - parsed.oreGradeGpt) < 0.5 ? 1 : 0.8;
    const weight = geoWeight * recencyWeight * gradeMatch;
    return { id: c.id, weight, pricePerTonne: c.pricePerTonne };
  });

  const totalWeight = weighted.reduce((sum, w) => sum + w.weight, 0);
  const weightedAvg =
    totalWeight === 0
      ? 0
      : weighted.reduce((sum, w) => sum + w.pricePerTonne * w.weight, 0) / totalWeight;

  const conditionAdj = CONDITION_ADJUSTMENT[parsed.condition];
  const ageAdj = Math.max(0.6, 1 - parsed.ageYears * 0.01);
  const estimatePerTonne = Math.round(weightedAvg * conditionAdj * ageAdj);
  const estimateTotal = estimatePerTonne * parsed.reserveTonnes;

  const spread = estimateTotal * 0.12;
  const rangeLow = Math.round(estimateTotal - spread);
  const rangeHigh = Math.round(estimateTotal + spread);

  const confidence: AssetValuationResult['confidence'] =
    parsed.comparables.length >= 8
      ? 'high'
      : parsed.comparables.length >= 4
        ? 'medium'
        : 'low';

  return {
    assetId: parsed.assetId,
    estimatePerTonne,
    estimateTotal: Math.round(estimateTotal),
    rangeLow,
    rangeHigh,
    confidence,
    comparablesUsed: weighted.map((w) => ({ id: w.id, weight: Math.round(w.weight * 1000) / 1000 })),
    currency: parsed.currency,
  };
}

export const assetValuationTool: ToolHandler = {
  name: 'skill.estate.asset_valuation',
  description:
    'Estimate a mineral asset value from recent comparables. Adjusts for condition, age, ore grade, geo distance, recency. Returns point estimate + range + confidence.',
  parameters: {
    type: 'object',
    required: ['assetId', 'oreGradeGpt', 'reserveTonnes', 'ageYears', 'comparables'],
    properties: {
      assetId: { type: 'string' },
      oreGradeGpt: { type: 'number' },
      reserveTonnes: { type: 'number' },
      ageYears: { type: 'number' },
      condition: { type: 'string', enum: ['excellent', 'good', 'fair', 'poor'] },
      currency: { type: 'string', minLength: 3, maxLength: 3 },
      comparables: { type: 'array', items: { type: 'object' } },
    },
  },
  async execute(params) {
    const parsed = AssetValuationParamsSchema.safeParse(params);
    if (!parsed.success) return { ok: false, error: parsed.error.message };
    const result = valueAsset(parsed.data);
    return {
      ok: true,
      data: result,
      evidenceSummary: `Valued ${result.assetId} at ${result.estimateTotal} ${result.currency} (${result.confidence} confidence)`,
    };
  },
};
