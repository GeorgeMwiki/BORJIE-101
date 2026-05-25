/**
 * Zod schemas + types for mining-commodity-intelligence.
 */

import { z } from 'zod';

export const commoditySchema = z.enum([
  'gold',
  'silver',
  'copper',
  'cobalt',
  'nickel',
  'tin',
  'zinc',
  'lead',
]);
export type Commodity = z.infer<typeof commoditySchema>;

export const currencyCodeSchema = z.enum(['USD', 'EUR', 'GBP', 'TZS']);
export type CurrencyCode = z.infer<typeof currencyCodeSchema>;

export const priceTickSchema = z.object({
  commodity: commoditySchema,
  /** Spot price per metric tonne, in the quoted currency. */
  pricePerTonne: z.number().positive(),
  currency: currencyCodeSchema,
  source: z.string(),
  asOfISO: z.string(),
});
export type PriceTick = z.infer<typeof priceTickSchema>;

export const priceHistorySchema = z.object({
  commodity: commoditySchema,
  ticks: z.array(priceTickSchema).min(1),
});
export type PriceHistory = z.infer<typeof priceHistorySchema>;

export const intelInputSchema = z.object({
  commodity: commoditySchema,
  histories: z.array(priceHistorySchema).min(1),
  baseCurrency: currencyCodeSchema.default('USD'),
});
export type IntelInput = z.infer<typeof intelInputSchema>;

// ─── Output ───────────────────────────────────────────────────────

export const trendDirectionSchema = z.enum(['up', 'flat', 'down']);
export type TrendDirection = z.infer<typeof trendDirectionSchema>;

export const trendWindowSchema = z.object({
  label: z.string(),
  spanDays: z.number().int().positive(),
  startPrice: z.number(),
  endPrice: z.number(),
  percentChange: z.number(),
  direction: trendDirectionSchema,
});
export type TrendWindow = z.infer<typeof trendWindowSchema>;

export const intelSnapshotSchema = z.object({
  commodity: commoditySchema,
  baseCurrency: currencyCodeSchema,
  latestPrice: z.number(),
  windows: z.array(trendWindowSchema),
  computedAtISO: z.string(),
  sources: z.array(z.string()),
});
export type IntelSnapshot = z.infer<typeof intelSnapshotSchema>;

// ─── Recommendation ───────────────────────────────────────────────

export const evidenceRefSchema = z.object({
  id: z.string(),
  kind: z.enum(['price-tick', 'trend-window', 'source']),
  pointer: z.string(),
});
export type EvidenceRef = z.infer<typeof evidenceRefSchema>;

export const intelRecommendationKindSchema = z.enum([
  'lock-offtake-price',
  'delay-sale',
  'accelerate-sale',
  'rebench-cost-model',
]);
export type IntelRecommendationKind = z.infer<typeof intelRecommendationKindSchema>;

export const intelRecommendationSchema = z.object({
  id: z.string(),
  kind: intelRecommendationKindSchema,
  title: z.string(),
  rationale: z.string(),
  severity: z.enum(['info', 'low', 'medium', 'high', 'critical']),
  evidence: z.array(evidenceRefSchema).min(1),
});
export type IntelRecommendation = z.infer<typeof intelRecommendationSchema>;

export const intelRecommendationContextSchema = z.object({
  snapshot: intelSnapshotSchema,
  policy: z
    .object({
      lockOnUpswingPercent: z.number().default(5),
      delaySaleOnDownswingPercent: z.number().default(-5),
    })
    .default({}),
});
export type IntelRecommendationContext = z.infer<
  typeof intelRecommendationContextSchema
>;
