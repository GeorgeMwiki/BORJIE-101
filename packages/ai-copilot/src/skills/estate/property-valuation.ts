/**
 * skill.estate.property_valuation — AVM-style valuation from comparables.
 *
 * Deterministic heuristic: weighted median of recent comparable sales +
 * adjustments for bed count, age, condition. Returns a range with
 * confidence and the comparables that drove it.
 */

import { z } from 'zod';
import { ToolHandler } from '../../orchestrator/tool-dispatcher.js';

export const ComparableSchema = z.object({
  id: z.string().min(1),
  pricePerSqm: z.number().positive(),
  bedrooms: z.number().int().positive(),
  ageYears: z.number().int().nonnegative(),
  condition: z.enum(['excellent', 'good', 'fair', 'poor']).default('good'),
  distanceKm: z.number().nonnegative(),
  soldMonthsAgo: z.number().int().nonnegative(),
});
export type Comparable = z.infer<typeof ComparableSchema>;

export const PropertyValuationParamsSchema = z.object({
  propertyId: z.string().min(1),
  bedrooms: z.number().int().positive(),
  sqm: z.number().positive(),
  ageYears: z.number().int().nonnegative(),
  condition: z.enum(['excellent', 'good', 'fair', 'poor']).default('good'),
  comparables: z.array(ComparableSchema).min(1).max(30),
  // Follow-up KI-005 (#33): caller should pass tenant.defaultCurrency resolved
  //   from the country plugin. Any ISO-4217 code is accepted today; the
  //   USD fallback is neutral. See Docs/KNOWN_ISSUES.md#ki-005.
  currency: z.string().length(3).default('USD'),
});
export type PropertyValuationParams = z.infer<typeof PropertyValuationParamsSchema>;

export interface PropertyValuationResult {
  readonly propertyId: string;
  readonly estimatePerSqm: number;
  readonly estimateTotal: number;
  readonly rangeLow: number;
  readonly rangeHigh: number;
  readonly confidence: 'low' | 'medium' | 'high';
  readonly comparablesUsed: ReadonlyArray<{ id: string; weight: number }>;
  readonly currency: PropertyValuationParams['currency'];
}

const CONDITION_ADJUSTMENT: Record<Comparable['condition'], number> = {
  excellent: 1.1,
  good: 1.0,
  fair: 0.9,
  poor: 0.75,
};

export function valueProperty(params: PropertyValuationParams): PropertyValuationResult {
  const parsed = PropertyValuationParamsSchema.parse(params);

  // Weight each comparable by (1 / (1 + distanceKm)) * (1 / (1 + monthsAgo/6)).
  const weighted = parsed.comparables.map((c) => {
    const geoWeight = 1 / (1 + c.distanceKm * 0.5);
    const recencyWeight = 1 / (1 + c.soldMonthsAgo / 6);
    const bedMatch = c.bedrooms === parsed.bedrooms ? 1 : 0.8;
    const weight = geoWeight * recencyWeight * bedMatch;
    return { id: c.id, weight, pricePerSqm: c.pricePerSqm };
  });

  const totalWeight = weighted.reduce((sum, w) => sum + w.weight, 0);
  const weightedAvg =
    totalWeight === 0
      ? 0
      : weighted.reduce((sum, w) => sum + w.pricePerSqm * w.weight, 0) / totalWeight;

  const conditionAdj = CONDITION_ADJUSTMENT[parsed.condition];
  const ageAdj = Math.max(0.6, 1 - parsed.ageYears * 0.01);
  const estimatePerSqm = Math.round(weightedAvg * conditionAdj * ageAdj);
  const estimateTotal = estimatePerSqm * parsed.sqm;

  const spread = estimateTotal * 0.12;
  const rangeLow = Math.round(estimateTotal - spread);
  const rangeHigh = Math.round(estimateTotal + spread);

  const confidence: PropertyValuationResult['confidence'] =
    parsed.comparables.length >= 8
      ? 'high'
      : parsed.comparables.length >= 4
        ? 'medium'
        : 'low';

  return {
    propertyId: parsed.propertyId,
    estimatePerSqm,
    estimateTotal: Math.round(estimateTotal),
    rangeLow,
    rangeHigh,
    confidence,
    comparablesUsed: weighted.map((w) => ({ id: w.id, weight: Math.round(w.weight * 1000) / 1000 })),
    currency: parsed.currency,
  };
}

export const propertyValuationTool: ToolHandler = {
  name: 'skill.estate.property_valuation',
  description:
    'Estimate a property value from recent comparables. Adjusts for condition, age, bed count, geo distance, recency. Returns point estimate + range + confidence.',
  parameters: {
    type: 'object',
    required: ['propertyId', 'bedrooms', 'sqm', 'ageYears', 'comparables'],
    properties: {
      propertyId: { type: 'string' },
      bedrooms: { type: 'number' },
      sqm: { type: 'number' },
      ageYears: { type: 'number' },
      condition: { type: 'string', enum: ['excellent', 'good', 'fair', 'poor'] },
      currency: { type: 'string', minLength: 3, maxLength: 3 },
      comparables: { type: 'array', items: { type: 'object' } },
    },
  },
  async execute(params) {
    const parsed = PropertyValuationParamsSchema.safeParse(params);
    if (!parsed.success) return { ok: false, error: parsed.error.message };
    const result = valueProperty(parsed.data);
    return {
      ok: true,
      data: result,
      evidenceSummary: `Valued ${result.propertyId} at ${result.estimateTotal} ${result.currency} (${result.confidence} confidence)`,
    };
  },
};
