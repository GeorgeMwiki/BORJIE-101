'use client';

import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { apiRequest } from '@/lib/api-client';

/**
 * Commodity-intelligence query hook — price-trend advice off the live
 * mining BFF.
 *
 * Live endpoint: GET /api/v1/mining/commodity-intelligence/advice?commodity=gold
 * (services/api-gateway/src/routes/mining/commodity-intelligence.hono.ts).
 * The gateway computes via the real `@borjie/mining-commodity-intelligence`
 * (multi-source merge → 1d/7d/30d/90d trend windows → lock / delay-sale
 * recommendations) over the global `mineral_prices` ticker. The ticker is
 * a tenant-agnostic benchmark (RLS-exempt, like fx_rates); the
 * `{ success, data }` envelope is unwrapped by `apiRequest`.
 */

export const COMMODITIES = [
  'gold',
  'silver',
  'copper',
  'cobalt',
  'nickel',
  'tin',
  'zinc',
  'lead',
] as const;
export type Commodity = (typeof COMMODITIES)[number];

const EvidenceRefSchema = z.object({
  id: z.string(),
  kind: z.string(),
  pointer: z.string(),
});

const RecommendationSchema = z.object({
  id: z.string(),
  kind: z.string(),
  title: z.string(),
  rationale: z.string(),
  severity: z.enum(['info', 'low', 'medium', 'high', 'critical']),
  evidence: z.array(EvidenceRefSchema),
});
export type IntelRecommendation = z.infer<typeof RecommendationSchema>;

const TrendWindowSchema = z.object({
  label: z.string(),
  spanDays: z.number(),
  startPrice: z.number(),
  endPrice: z.number(),
  percentChange: z.number(),
  direction: z.enum(['up', 'flat', 'down']),
});
export type TrendWindow = z.infer<typeof TrendWindowSchema>;

const SnapshotSchema = z.object({
  commodity: z.string(),
  baseCurrency: z.string(),
  latestPrice: z.number(),
  windows: z.array(TrendWindowSchema),
  sources: z.array(z.string()),
  computedAtISO: z.string(),
});
export type IntelSnapshot = z.infer<typeof SnapshotSchema>;

const AdviceSchema = z.object({
  snapshot: SnapshotSchema.nullable().default(null),
  recommendations: z.array(RecommendationSchema).default([]),
  evidenceIds: z.array(z.string()).default([]),
  note: z.string().optional(),
});
export type CommodityAdvice = z.infer<typeof AdviceSchema>;

export const commodityIntelKeys = {
  advice: (commodity: Commodity) =>
    ['commodity-intelligence', 'advice', commodity] as const,
};

export function useCommodityAdvice(opts: {
  readonly commodity: Commodity;
  readonly lookbackDays?: number;
}) {
  return useQuery({
    queryKey: commodityIntelKeys.advice(opts.commodity),
    queryFn: async ({ signal }): Promise<CommodityAdvice> => {
      const qs = new URLSearchParams();
      qs.set('commodity', opts.commodity);
      if (opts.lookbackDays !== undefined) {
        qs.set('lookbackDays', String(opts.lookbackDays));
      }
      const raw = await apiRequest<unknown>(
        `/api/v1/mining/commodity-intelligence/advice?${qs.toString()}`,
        { signal },
      );
      return AdviceSchema.parse(raw);
    },
    staleTime: 60_000,
  });
}
