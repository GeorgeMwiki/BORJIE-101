/**
 * Zod schemas + inferred types for cost-engineer-advisor inputs and
 * outputs. Pure data — no I/O.
 */

import { z } from 'zod';

// ─── Currency helpers ─────────────────────────────────────────────

export const currencyCodeSchema = z.enum(['TZS', 'USD', 'EUR', 'GBP']);
export type CurrencyCode = z.infer<typeof currencyCodeSchema>;

export const moneySchema = z.object({
  amount: z.number().finite(),
  currency: currencyCodeSchema,
});
export type Money = z.infer<typeof moneySchema>;

// ─── Inputs ───────────────────────────────────────────────────────

export const opexBucketSchema = z.object({
  label: z.string().min(1),
  amount: z.number().nonnegative(),
  fixed: z.boolean().default(false),
});
export type OpexBucket = z.infer<typeof opexBucketSchema>;

export const productionPeriodSchema = z.object({
  periodLabel: z.string().min(1),
  startISO: z.string().min(8),
  endISO: z.string().min(8),
  tonnesProduced: z.number().nonnegative(),
  tonnesSold: z.number().nonnegative(),
  averageRealisedPricePerTonne: z.number().nonnegative(),
});
export type ProductionPeriod = z.infer<typeof productionPeriodSchema>;

export const cogsContextSchema = z.object({
  royaltyRate: z.number().min(0).max(1),
  /** Smelting/refining/transport — bundled fixed deduction per tonne. */
  treatmentChargesPerTonne: z.number().nonnegative().default(0),
});
export type CogsContext = z.infer<typeof cogsContextSchema>;

export const costAnalyzeInputSchema = z.object({
  period: productionPeriodSchema,
  currency: currencyCodeSchema,
  opexBuckets: z.array(opexBucketSchema).min(1),
  capexAmortisationForPeriod: z.number().nonnegative().default(0),
  cogs: cogsContextSchema,
});
export type CostAnalyzeInput = z.infer<typeof costAnalyzeInputSchema>;

// ─── Outputs ──────────────────────────────────────────────────────

export const pnlLineSchema = z.object({
  label: z.string(),
  amount: z.number(),
  percentOfRevenue: z.number(),
});
export type PnlLine = z.infer<typeof pnlLineSchema>;

export const pnlSchema = z.object({
  revenue: z.number(),
  cogs: z.number(),
  grossProfit: z.number(),
  opexTotal: z.number(),
  ebitda: z.number(),
  depreciation: z.number(),
  ebit: z.number(),
  netMarginPercent: z.number(),
  lines: z.array(pnlLineSchema),
});
export type Pnl = z.infer<typeof pnlSchema>;

export const unitEconomicsSchema = z.object({
  costPerTonne: z.number(),
  cashCostPerTonne: z.number(),
  allInSustainingCostPerTonne: z.number(),
  marginPerTonne: z.number(),
  breakEvenPricePerTonne: z.number(),
});
export type UnitEconomics = z.infer<typeof unitEconomicsSchema>;

export const sensitivityRowSchema = z.object({
  /** e.g. -10 means "what if price drops 10%". */
  deltaPercent: z.number(),
  ebitda: z.number(),
  marginPerTonne: z.number(),
});
export type SensitivityRow = z.infer<typeof sensitivityRowSchema>;

export const sensitivitySchema = z.object({
  priceSensitivity: z.array(sensitivityRowSchema),
  fuelSensitivity: z.array(sensitivityRowSchema),
});
export type Sensitivity = z.infer<typeof sensitivitySchema>;

export const costAnalysisSchema = z.object({
  period: productionPeriodSchema,
  currency: currencyCodeSchema,
  pnl: pnlSchema,
  unit: unitEconomicsSchema,
  sensitivity: sensitivitySchema,
  computedAtISO: z.string(),
});
export type CostAnalysis = z.infer<typeof costAnalysisSchema>;

// ─── Recommendation ───────────────────────────────────────────────

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
  kind: z.enum(['opex-bucket', 'pnl-line', 'sensitivity-row', 'period']),
  pointer: z.string(),
});
export type EvidenceRef = z.infer<typeof evidenceRefSchema>;

export const recommendationSchema = z.object({
  id: z.string(),
  title: z.string(),
  rationale: z.string(),
  severity: recommendationSeveritySchema,
  estimatedSavingsPerPeriod: moneySchema.optional(),
  evidence: z.array(evidenceRefSchema).min(1),
});
export type Recommendation = z.infer<typeof recommendationSchema>;

export const recommendationContextSchema = z.object({
  analysis: costAnalysisSchema,
  /** Caller-supplied targets — e.g. industry benchmarks. */
  benchmarks: z
    .object({
      maxFuelShareOfOpex: z.number().min(0).max(1).default(0.3),
      minNetMarginPercent: z.number().default(0.15),
      maxCostPerTonneTZS: z.number().nonnegative().optional(),
    })
    .default({}),
});
export type RecommendationContext = z.infer<typeof recommendationContextSchema>;
