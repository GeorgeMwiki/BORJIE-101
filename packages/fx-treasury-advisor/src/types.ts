/**
 * Zod schemas + types for the FX-treasury advisor.
 */

import { z } from 'zod';

export const currencyCodeSchema = z.enum(['TZS', 'USD', 'EUR', 'GBP']);
export type CurrencyCode = z.infer<typeof currencyCodeSchema>;

export const moneySchema = z.object({
  amount: z.number().finite(),
  currency: currencyCodeSchema,
});
export type Money = z.infer<typeof moneySchema>;

// ─── Treasury input ───────────────────────────────────────────────

export const cashBalanceSchema = z.object({
  accountId: z.string(),
  currency: currencyCodeSchema,
  balance: z.number(),
  asOfISO: z.string(),
});
export type CashBalance = z.infer<typeof cashBalanceSchema>;

export const cashflowSchema = z.object({
  id: z.string(),
  direction: z.enum(['in', 'out']),
  dueISO: z.string(),
  amount: z.number().nonnegative(),
  currency: currencyCodeSchema,
  category: z.enum([
    'payroll',
    'fuel',
    'royalty',
    'tax',
    'capex',
    'off-take',
    'loan-service',
    'other',
  ]),
  counterparty: z.string().optional(),
});
export type Cashflow = z.infer<typeof cashflowSchema>;

export const stockpileSchema = z.object({
  id: z.string(),
  tonnes: z.number().nonnegative(),
  estimatedSpotPricePerTonne: z.number().nonnegative(),
  ageDays: z.number().int().nonnegative(),
});
export type Stockpile = z.infer<typeof stockpileSchema>;

export const fxRateSchema = z.object({
  pair: z.string().regex(/^[A-Z]{3}\/[A-Z]{3}$/),
  rate: z.number().positive(),
  asOfISO: z.string(),
});
export type FxRate = z.infer<typeof fxRateSchema>;

export const treasuryInputSchema = z.object({
  baseCurrency: currencyCodeSchema,
  horizonDays: z.number().int().positive().default(60),
  balances: z.array(cashBalanceSchema).min(1),
  cashflows: z.array(cashflowSchema),
  stockpiles: z.array(stockpileSchema).default([]),
  fxRates: z.array(fxRateSchema).default([]),
  /** USD cliff date — defaults to the next March-27 USD-obligation cluster. */
  usdCliffDateISO: z.string().optional(),
});
export type TreasuryInput = z.infer<typeof treasuryInputSchema>;

// ─── Outputs ──────────────────────────────────────────────────────

export const runwayPointSchema = z.object({
  dateISO: z.string(),
  balanceBase: z.number(),
  /** Cumulative in / out for the day in base-currency. */
  netFlowBase: z.number(),
});
export type RunwayPoint = z.infer<typeof runwayPointSchema>;

export const runwayProjectionSchema = z.object({
  baseCurrency: currencyCodeSchema,
  horizonDays: z.number().int(),
  points: z.array(runwayPointSchema),
  /** First day balance goes <= 0; null = never within horizon. */
  zeroCrossingISO: z.string().nullable(),
  minBalanceBase: z.number(),
});
export type RunwayProjection = z.infer<typeof runwayProjectionSchema>;

export const exposureRowSchema = z.object({
  currency: currencyCodeSchema,
  netPosition: z.number(),
  /** Net position translated to base currency at current spot. */
  netPositionBase: z.number(),
});
export type ExposureRow = z.infer<typeof exposureRowSchema>;

export const fxExposureSchema = z.object({
  baseCurrency: currencyCodeSchema,
  rows: z.array(exposureRowSchema),
});
export type FxExposure = z.infer<typeof fxExposureSchema>;

export const treasuryAnalysisSchema = z.object({
  runway: runwayProjectionSchema,
  exposure: fxExposureSchema,
  computedAtISO: z.string(),
});
export type TreasuryAnalysis = z.infer<typeof treasuryAnalysisSchema>;

// ─── Recommendation surface ───────────────────────────────────────

export const recommendationSeveritySchema = z.enum([
  'info',
  'low',
  'medium',
  'high',
  'critical',
]);
export type RecommendationSeverity = z.infer<typeof recommendationSeveritySchema>;

export const evidenceRefSchema = z.object({
  id: z.string(),
  kind: z.enum(['runway-point', 'exposure-row', 'cashflow', 'stockpile']),
  pointer: z.string(),
});
export type EvidenceRef = z.infer<typeof evidenceRefSchema>;

export const treasuryRecommendationKindSchema = z.enum([
  'sell-stockpile',
  'partial-fx-hedge',
  'delay-capex',
  'accelerate-receivable',
  'usd-cliff-remediation',
  'rebalance-account',
]);
export type TreasuryRecommendationKind = z.infer<
  typeof treasuryRecommendationKindSchema
>;

export const treasuryRecommendationSchema = z.object({
  id: z.string(),
  kind: treasuryRecommendationKindSchema,
  title: z.string(),
  rationale: z.string(),
  severity: recommendationSeveritySchema,
  estimatedImpact: moneySchema.optional(),
  evidence: z.array(evidenceRefSchema).min(1),
});
export type TreasuryRecommendation = z.infer<typeof treasuryRecommendationSchema>;

export const treasuryRecommendationContextSchema = z.object({
  analysis: treasuryAnalysisSchema,
  input: treasuryInputSchema,
  policy: z
    .object({
      minRunwayDays: z.number().int().positive().default(30),
      maxSingleCurrencyExposureRatio: z.number().min(0).max(1).default(0.6),
    })
    .default({}),
});
export type TreasuryRecommendationContext = z.infer<
  typeof treasuryRecommendationContextSchema
>;
