'use client';

/**
 * Market-intelligence query hooks — backed by the live mining BFF at
 * `/api/v1/mining/market-intelligence/*`
 * (services/api-gateway/src/routes/mining/market-intelligence.hono.ts).
 *
 * The gateway computes via the real `@borjie/market-intelligence`
 * (commodity tracking → 90-day demand forecast with p5/p50/p95 bands →
 * disruption alerts → buy/sell/hold signals with causal reasoning).
 *
 * REAL price source: gold is priced + back-tested from the append-only
 * `fx_rates` table (LBMA fix). Copper + tanzanite have no live feed yet,
 * so those endpoints answer 503 `FEED_UNAVAILABLE`; the hooks surface
 * that distinctly so the panel renders an honest "feed not wired" state
 * rather than a fabricated number.
 *
 * Responses are zod-validated; the `{ success, data }` envelope is
 * unwrapped by `apiRequest`. Price currency is DATA (USD for the gold
 * fix), threaded into `formatCurrency` by the panel — never hardcoded.
 */

import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { apiRequest, ApiError } from '@/lib/api-client';

export const MARKET_COMMODITIES = ['gold', 'copper', 'tanzanite'] as const;
export type MarketCommodity = (typeof MARKET_COMMODITIES)[number];

// ─── Response schemas (mirror @borjie/market-intelligence) ────────────

const CommodityPriceSchema = z.object({
  commodity: z.enum(MARKET_COMMODITIES),
  tenantId: z.string(),
  price: z.number(),
  currency: z.enum(['USD', 'TZS']),
  asOfISO: z.string(),
  source: z.string(),
  region: z.string().optional(),
  grade: z.string().optional(),
  tzsEquivalent: z.number().optional(),
  regulatoryTags: z.array(z.string()).default([]),
});
export type CommodityPrice = z.infer<typeof CommodityPriceSchema>;

const PriceResultSchema = z.object({ price: CommodityPriceSchema });

const ForecastPointSchema = z.object({
  dayOffset: z.number(),
  asOfISO: z.string(),
  p5: z.number(),
  p50: z.number(),
  p95: z.number(),
});
export type ForecastPoint = z.infer<typeof ForecastPointSchema>;

const DemandForecastSchema = z.object({
  commodity: z.enum(MARKET_COMMODITIES),
  tenantId: z.string(),
  horizonDays: z.number(),
  points: z.array(ForecastPointSchema).min(1),
  drivers: z.array(z.string()).min(1),
  confidence: z.number(),
  computedAtISO: z.string(),
  regulatoryTags: z.array(z.string()).default([]),
});
export type DemandForecast = z.infer<typeof DemandForecastSchema>;

const ForecastResultSchema = z.object({ forecast: DemandForecastSchema });

const DisruptionAlertSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  commodity: z.enum(MARKET_COMMODITIES),
  kind: z.enum(['logistics', 'regulatory', 'weather', 'geopolitics']),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  headline: z.string(),
  rationale: z.string(),
  region: z.string().optional(),
  detectedAtISO: z.string(),
  regulatoryTags: z.array(z.string()).default([]),
});
export type DisruptionAlert = z.infer<typeof DisruptionAlertSchema>;

const DisruptionsResultSchema = z.object({
  alerts: z.array(DisruptionAlertSchema),
});

const SellSignalSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  commodity: z.enum(MARKET_COMMODITIES),
  action: z.enum(['buy', 'sell', 'hold']),
  confidence: z.number(),
  reasoning: z.array(z.string()).min(1),
  horizonDays: z.number(),
  computedAtISO: z.string(),
  regulatoryTags: z.array(z.string()).default([]),
});
export type SellSignal = z.infer<typeof SellSignalSchema>;

const SignalsResultSchema = z.object({ signals: z.array(SellSignalSchema) });

// ─── Query keys ───────────────────────────────────────────────────────

export const marketIntelKeys = {
  all: ['market-intelligence'] as const,
  price: (commodity: MarketCommodity) =>
    ['market-intelligence', 'price', commodity] as const,
  forecast: (commodity: MarketCommodity) =>
    ['market-intelligence', 'forecast', commodity] as const,
  disruptions: () => ['market-intelligence', 'disruptions'] as const,
  signals: (commodity: MarketCommodity) =>
    ['market-intelligence', 'signals', commodity] as const,
};

/**
 * Distinguish an honest "no feed wired" 503 from a real failure so the
 * panel can render a calm empty state for copper/tanzanite instead of an
 * error toast. Returns `true` when the gateway answered FEED_UNAVAILABLE
 * or INSUFFICIENT_HISTORY (both are 503 with a known code).
 */
export function isFeedUnavailable(error: unknown): boolean {
  return error instanceof ApiError && error.status === 503;
}

// Do not retry a 503 feed-unavailable — it is a stable state, not a blip.
function retryUnlessFeedUnavailable(failureCount: number, error: unknown): boolean {
  if (isFeedUnavailable(error)) return false;
  return failureCount < 2;
}

// ─── Hooks ────────────────────────────────────────────────────────────

export function useCommodityPrice(commodity: MarketCommodity) {
  return useQuery({
    queryKey: marketIntelKeys.price(commodity),
    queryFn: async ({ signal }): Promise<CommodityPrice> => {
      const raw = await apiRequest<unknown>(
        `/api/v1/mining/market-intelligence/price/${commodity}`,
        { signal },
      );
      return PriceResultSchema.parse(raw).price;
    },
    retry: retryUnlessFeedUnavailable,
    staleTime: 60_000,
  });
}

export function useCommodityForecast(commodity: MarketCommodity) {
  return useQuery({
    queryKey: marketIntelKeys.forecast(commodity),
    queryFn: async ({ signal }): Promise<DemandForecast> => {
      const raw = await apiRequest<unknown>(
        `/api/v1/mining/market-intelligence/forecast/${commodity}`,
        { signal },
      );
      return ForecastResultSchema.parse(raw).forecast;
    },
    retry: retryUnlessFeedUnavailable,
    staleTime: 5 * 60_000,
  });
}

export function useDisruptionAlerts() {
  return useQuery({
    queryKey: marketIntelKeys.disruptions(),
    queryFn: async ({ signal }): Promise<ReadonlyArray<DisruptionAlert>> => {
      const raw = await apiRequest<unknown>(
        '/api/v1/mining/market-intelligence/disruptions',
        { signal },
      );
      return DisruptionsResultSchema.parse(raw).alerts;
    },
    staleTime: 2 * 60_000,
  });
}

export function useSellSignals(commodity: MarketCommodity) {
  return useQuery({
    queryKey: marketIntelKeys.signals(commodity),
    queryFn: async ({ signal }): Promise<ReadonlyArray<SellSignal>> => {
      const raw = await apiRequest<unknown>(
        `/api/v1/mining/market-intelligence/sell-signals/${commodity}`,
        { signal },
      );
      return SignalsResultSchema.parse(raw).signals;
    },
    retry: retryUnlessFeedUnavailable,
    staleTime: 60_000,
  });
}
