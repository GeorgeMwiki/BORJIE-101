/**
 * Public types + Zod schemas for `@borjie/market-intelligence`.
 *
 * Tanzania mining market intelligence — gold / copper / tanzanite.
 * Schemas validate at the package boundary; never trust raw input.
 *
 * Persona: Mr. Mwikila. Brand: Borjie.
 */

import { z } from 'zod';

// ─── Commodity enum ───────────────────────────────────────────────
// The wrapped `@borjie/mining-commodity-intelligence` covers gold,
// silver, copper, cobalt, nickel, tin, zinc, lead. We narrow to the
// three Tanzania-priority commodities for this package.

export const commoditySchema = z.enum(['gold', 'copper', 'tanzanite']);
export type Commodity = z.infer<typeof commoditySchema>;

// ─── Region / regulatory context ─────────────────────────────────

export const tanzaniaRegionSchema = z.enum([
  'mwadui',
  'mbeya',
  'karatu',
  'mererani',
  'geita',
  'shinyanga',
  'kahama',
  'other',
]);
export type TanzaniaRegion = z.infer<typeof tanzaniaRegionSchema>;

export const regulatoryContextTagSchema = z.enum([
  'OSHA-TZ',
  'TMAA',
  'TRA-ROYALTY',
  'EWURA-FUEL',
  'BOT-FX',
]);
export type RegulatoryContextTag = z.infer<typeof regulatoryContextTagSchema>;

// ─── Currency + price ────────────────────────────────────────────

export const currencyCodeSchema = z.enum(['USD', 'TZS']);
export type CurrencyCode = z.infer<typeof currencyCodeSchema>;

export const commodityPriceSchema = z.object({
  commodity: commoditySchema,
  tenantId: z.string().min(1),
  /** Spot or fix price in the quoted currency. */
  price: z.number().positive(),
  currency: currencyCodeSchema,
  /** ISO-8601 UTC timestamp of the price point. */
  asOfISO: z.string(),
  /** Source identifier (e.g. lbma-am, lbma-pm, lme-3m, block-c-prod). */
  source: z.string().min(1),
  /** Optional Tanzania region the price applies to. */
  region: tanzaniaRegionSchema.optional(),
  /** Optional grade label (e.g. "block-c-aaa", "lme-grade-a"). */
  grade: z.string().optional(),
  /** TZS-converted price when `currency === 'USD'`. */
  tzsEquivalent: z.number().positive().optional(),
  /** Regulatory tags relevant to this price observation. */
  regulatoryTags: z.array(regulatoryContextTagSchema).default([]),
});
export type CommodityPrice = z.infer<typeof commodityPriceSchema>;

// ─── Forecast input + output ─────────────────────────────────────

export const forecastInputSchema = z.object({
  commodity: commoditySchema,
  tenantId: z.string().min(1),
  /** Recent price history used as the model fit window. */
  history: z
    .array(
      z.object({
        asOfISO: z.string(),
        price: z.number().positive(),
      }),
    )
    .min(2),
  /** Horizon in days; capped at 90 by the forecaster. */
  horizonDays: z.number().int().positive().max(180).default(90),
  /** Optional driver hints supplied by the caller. */
  driverHints: z.array(z.string()).default([]),
});
export type ForecastInput = z.infer<typeof forecastInputSchema>;

export const forecastPointSchema = z.object({
  /** Days from forecast origin (1..N). */
  dayOffset: z.number().int().positive(),
  /** ISO date for the point. */
  asOfISO: z.string(),
  /** 5th percentile band. */
  p5: z.number(),
  /** Median forecast. */
  p50: z.number(),
  /** 95th percentile band. */
  p95: z.number(),
});
export type ForecastPoint = z.infer<typeof forecastPointSchema>;

export const demandForecastSchema = z.object({
  commodity: commoditySchema,
  tenantId: z.string().min(1),
  horizonDays: z.number().int().positive(),
  points: z.array(forecastPointSchema).min(1),
  /** Plain-language driver narrative. */
  drivers: z.array(z.string()).min(1),
  /** Conformal-style coverage estimate of the [p5,p95] band. */
  confidence: z.number().min(0).max(1),
  /** ISO timestamp of when this forecast was computed. */
  computedAtISO: z.string(),
  /** Regulatory context tags carried through to the forecast. */
  regulatoryTags: z.array(regulatoryContextTagSchema).default([]),
});
export type DemandForecast = z.infer<typeof demandForecastSchema>;

// ─── Disruption alerts ───────────────────────────────────────────

export const disruptionKindSchema = z.enum([
  'logistics',
  'regulatory',
  'weather',
  'geopolitics',
]);
export type DisruptionKind = z.infer<typeof disruptionKindSchema>;

export const disruptionSeveritySchema = z.enum(['low', 'medium', 'high', 'critical']);
export type DisruptionSeverity = z.infer<typeof disruptionSeveritySchema>;

export const disruptionAlertSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  commodity: commoditySchema,
  kind: disruptionKindSchema,
  severity: disruptionSeveritySchema,
  headline: z.string().min(1),
  rationale: z.string().min(1),
  region: tanzaniaRegionSchema.optional(),
  detectedAtISO: z.string(),
  /** Free-form evidence the detector can attach. */
  evidence: z.record(z.string(), z.unknown()).default({}),
  regulatoryTags: z.array(regulatoryContextTagSchema).default([]),
});
export type DisruptionAlert = z.infer<typeof disruptionAlertSchema>;

// ─── Sell signal ─────────────────────────────────────────────────

export const sellSignalActionSchema = z.enum(['buy', 'sell', 'hold']);
export type SellSignalAction = z.infer<typeof sellSignalActionSchema>;

export const sellSignalSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  commodity: commoditySchema,
  action: sellSignalActionSchema,
  /** Confidence in [0,1] — high = strong evidence. */
  confidence: z.number().min(0).max(1),
  /** Bulleted causal reasoning. */
  reasoning: z.array(z.string()).min(1),
  /** Time horizon over which the signal is relevant. */
  horizonDays: z.number().int().positive(),
  computedAtISO: z.string(),
  regulatoryTags: z.array(regulatoryContextTagSchema).default([]),
});
export type SellSignal = z.infer<typeof sellSignalSchema>;

// ─── Errors ──────────────────────────────────────────────────────

export class UnknownCommodityError extends Error {
  public override readonly name = 'UnknownCommodityError';
  public readonly code = 'UNKNOWN_COMMODITY';
  public readonly received: string;
  constructor(received: string) {
    super(
      `Unknown commodity "${received}". Supported: gold, copper, tanzanite.`,
    );
    this.received = received;
  }
}

export class ForecastUnavailableError extends Error {
  public override readonly name = 'ForecastUnavailableError';
  public readonly code = 'FORECAST_UNAVAILABLE';
  public readonly reason: string;
  constructor(reason: string) {
    super(`Forecast unavailable: ${reason}`);
    this.reason = reason;
  }
}

export class TenantPermissionError extends Error {
  public override readonly name = 'TenantPermissionError';
  public readonly code = 'TENANT_PERMISSION_DENIED';
  public readonly tenantId: string;
  constructor(tenantId: string, message?: string) {
    super(
      message ??
        `Tenant "${tenantId}" is not permitted to access market intelligence.`,
    );
    this.tenantId = tenantId;
  }
}
