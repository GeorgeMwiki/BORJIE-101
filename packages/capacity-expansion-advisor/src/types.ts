/**
 * Zod schemas + types for the capacity-expansion advisor.
 */

import { z } from 'zod';

export const currencyCodeSchema = z.enum(['TZS', 'USD', 'EUR', 'GBP']);
export type CurrencyCode = z.infer<typeof currencyCodeSchema>;

export const moneySchema = z.object({
  amount: z.number().finite(),
  currency: currencyCodeSchema,
});
export type Money = z.infer<typeof moneySchema>;

export const expansionKindSchema = z.enum([
  'new-shaft',
  'new-site',
  'processing-upgrade',
]);
export type ExpansionKind = z.infer<typeof expansionKindSchema>;

export const expansionScenarioInputSchema = z.object({
  id: z.string(),
  kind: expansionKindSchema,
  label: z.string(),
  upfrontCapex: z.number().nonnegative(),
  /** Year-by-year incremental net cashflow (positive = inflow). */
  incrementalCashflows: z.array(z.number()).min(1),
  /** Incremental tonnes/year throughput uplift. */
  incrementalTonnesPerYear: z.number().nonnegative().default(0),
  description: z.string().optional(),
});
export type ExpansionScenarioInput = z.infer<typeof expansionScenarioInputSchema>;

export const expansionAnalyzeInputSchema = z.object({
  currency: currencyCodeSchema,
  discountRate: z.number().min(0).max(1),
  scenarios: z.array(expansionScenarioInputSchema).min(1),
});
export type ExpansionAnalyzeInput = z.infer<typeof expansionAnalyzeInputSchema>;

// ─── Output ───────────────────────────────────────────────────────

export const scenarioOutcomeSchema = z.object({
  id: z.string(),
  kind: expansionKindSchema,
  label: z.string(),
  npv: z.number(),
  irr: z.number().nullable(),
  paybackYears: z.number().nullable(),
  totalIncrementalTonnes: z.number(),
  upfrontCapex: z.number(),
});
export type ScenarioOutcome = z.infer<typeof scenarioOutcomeSchema>;

export const expansionAnalysisSchema = z.object({
  currency: currencyCodeSchema,
  discountRate: z.number(),
  outcomes: z.array(scenarioOutcomeSchema),
  rankedByNpv: z.array(z.string()),
  computedAtISO: z.string(),
});
export type ExpansionAnalysis = z.infer<typeof expansionAnalysisSchema>;

// ─── Recommendation ───────────────────────────────────────────────

export const evidenceRefSchema = z.object({
  id: z.string(),
  kind: z.enum(['scenario', 'cashflow', 'capex']),
  pointer: z.string(),
});
export type EvidenceRef = z.infer<typeof evidenceRefSchema>;

export const expansionRecommendationSchema = z.object({
  id: z.string(),
  scenarioId: z.string(),
  title: z.string(),
  rationale: z.string(),
  severity: z.enum(['info', 'low', 'medium', 'high', 'critical']),
  evidence: z.array(evidenceRefSchema).min(1),
});
export type ExpansionRecommendation = z.infer<typeof expansionRecommendationSchema>;

export const expansionRecommendationContextSchema = z.object({
  analysis: expansionAnalysisSchema,
  policy: z
    .object({
      minNpv: z.number().default(0),
      maxPaybackYears: z.number().positive().default(5),
    })
    .default({}),
});
export type ExpansionRecommendationContext = z.infer<
  typeof expansionRecommendationContextSchema
>;
