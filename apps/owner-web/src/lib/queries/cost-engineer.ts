'use client';

/**
 * Cost-engineer advisor query/mutation hooks — backed by the live
 * mining BFF at `/api/v1/mining/cost-engineer/*`
 * (services/api-gateway/src/routes/mining/cost-engineer.hono.ts).
 *
 * The gateway computes via the real `@borjie/cost-engineer-advisor`
 * (P&L → unit economics → price/fuel sensitivity tables →
 * evidence-backed recommendations) and PERSISTS each analysis into the
 * tenant-scoped `unit_economics_snapshots` table.
 *
 * Every response is validated with zod before it reaches a component, so
 * a drifted contract surfaces as a query error rather than a render
 * crash. The `{ success, data }` envelope is unwrapped by `apiRequest`.
 *
 * Currency is DATA, never hardcoded: the analysis carries its own
 * `currency` (ISO-4217) which the panel threads into `formatCurrency`.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { apiRequest } from '@/lib/api-client';

export const CURRENCY_CODES = ['TZS', 'USD', 'EUR', 'GBP'] as const;
export type CurrencyCode = (typeof CURRENCY_CODES)[number];

// ─── Response schemas (mirror @borjie/cost-engineer-advisor) ──────────

const PnlLineSchema = z.object({
  label: z.string(),
  amount: z.number(),
  percentOfRevenue: z.number(),
});
export type PnlLine = z.infer<typeof PnlLineSchema>;

const PnlSchema = z.object({
  revenue: z.number(),
  cogs: z.number(),
  grossProfit: z.number(),
  opexTotal: z.number(),
  ebitda: z.number(),
  depreciation: z.number(),
  ebit: z.number(),
  netMarginPercent: z.number(),
  lines: z.array(PnlLineSchema),
});
export type Pnl = z.infer<typeof PnlSchema>;

const UnitEconomicsSchema = z.object({
  costPerTonne: z.number(),
  cashCostPerTonne: z.number(),
  allInSustainingCostPerTonne: z.number(),
  marginPerTonne: z.number(),
  breakEvenPricePerTonne: z.number(),
});
export type UnitEconomics = z.infer<typeof UnitEconomicsSchema>;

const SensitivityRowSchema = z.object({
  deltaPercent: z.number(),
  ebitda: z.number(),
  marginPerTonne: z.number(),
});
export type SensitivityRow = z.infer<typeof SensitivityRowSchema>;

const SensitivitySchema = z.object({
  priceSensitivity: z.array(SensitivityRowSchema),
  fuelSensitivity: z.array(SensitivityRowSchema),
});
export type Sensitivity = z.infer<typeof SensitivitySchema>;

const ProductionPeriodSchema = z.object({
  periodLabel: z.string(),
  startISO: z.string(),
  endISO: z.string(),
  tonnesProduced: z.number(),
  tonnesSold: z.number(),
  averageRealisedPricePerTonne: z.number(),
});
export type ProductionPeriod = z.infer<typeof ProductionPeriodSchema>;

const CostAnalysisSchema = z.object({
  period: ProductionPeriodSchema,
  currency: z.enum(CURRENCY_CODES),
  pnl: PnlSchema,
  unit: UnitEconomicsSchema,
  sensitivity: SensitivitySchema,
  computedAtISO: z.string(),
});
export type CostAnalysis = z.infer<typeof CostAnalysisSchema>;

const AnalyzeResultSchema = z.object({
  analysis: CostAnalysisSchema,
  persisted: z.boolean(),
  snapshotId: z.string().nullable(),
});
export type AnalyzeResult = z.infer<typeof AnalyzeResultSchema>;

const EvidenceRefSchema = z.object({
  id: z.string(),
  kind: z.string(),
  pointer: z.string(),
});

const RecommendationSchema = z.object({
  id: z.string(),
  title: z.string(),
  rationale: z.string(),
  severity: z.enum(['info', 'low', 'medium', 'high', 'critical']),
  estimatedSavingsPerPeriod: z
    .object({ amount: z.number(), currency: z.enum(CURRENCY_CODES) })
    .optional(),
  evidence: z.array(EvidenceRefSchema).min(1),
});
export type CostRecommendation = z.infer<typeof RecommendationSchema>;

const RecommendResultSchema = z.object({
  recommendations: z.array(RecommendationSchema),
});
export type RecommendResult = z.infer<typeof RecommendResultSchema>;

const SnapshotRowSchema = z.object({
  id: z.string(),
  siteId: z.string().nullable(),
  period: z.string(),
  summary: z.unknown(),
  computedAt: z.union([z.string(), z.date()]).optional(),
});
export type CostSnapshotRow = z.infer<typeof SnapshotRowSchema>;

// ─── Request payloads (mirror the advisor input schema) ───────────────

export interface OpexBucketInput {
  readonly label: string;
  readonly amount: number;
  readonly fixed?: boolean;
}

export interface CostAnalyzeRequest {
  readonly period: {
    readonly periodLabel: string;
    readonly startISO: string;
    readonly endISO: string;
    readonly tonnesProduced: number;
    readonly tonnesSold: number;
    readonly averageRealisedPricePerTonne: number;
  };
  readonly currency: CurrencyCode;
  readonly opexBuckets: ReadonlyArray<OpexBucketInput>;
  readonly capexAmortisationForPeriod?: number;
  readonly cogs: {
    readonly royaltyRate: number;
    readonly treatmentChargesPerTonne?: number;
  };
  readonly siteId?: string;
}

export interface CostBenchmarks {
  readonly maxFuelShareOfOpex?: number;
  readonly minNetMarginPercent?: number;
  readonly maxCostPerTonneTZS?: number;
}

// ─── Query keys ───────────────────────────────────────────────────────

export const costEngineerKeys = {
  all: ['cost-engineer'] as const,
  snapshots: (siteId?: string) =>
    ['cost-engineer', 'snapshots', siteId ?? 'all'] as const,
};

// ─── Hooks ────────────────────────────────────────────────────────────

/** Compute + persist a cost analysis. Invalidates the snapshots list. */
export function useCostAnalyze() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: CostAnalyzeRequest): Promise<AnalyzeResult> => {
      const raw = await apiRequest<unknown>('/api/v1/mining/cost-engineer/analyze', {
        method: 'POST',
        body,
      });
      return AnalyzeResultSchema.parse(raw);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: costEngineerKeys.all });
    },
  });
}

/** Derive evidence-backed recommendations from a computed analysis. */
export function useCostRecommend() {
  return useMutation({
    mutationFn: async (args: {
      readonly analysis: CostAnalysis;
      readonly benchmarks?: CostBenchmarks;
    }): Promise<RecommendResult> => {
      const raw = await apiRequest<unknown>('/api/v1/mining/cost-engineer/recommend', {
        method: 'POST',
        body: { analysis: args.analysis, benchmarks: args.benchmarks ?? {} },
      });
      return RecommendResultSchema.parse(raw);
    },
  });
}

/** List the tenant's recent persisted analyses (most-recent first). */
export function useCostSnapshots(opts: { readonly siteId?: string; readonly limit?: number } = {}) {
  return useQuery({
    queryKey: costEngineerKeys.snapshots(opts.siteId),
    queryFn: async ({ signal }): Promise<ReadonlyArray<CostSnapshotRow>> => {
      const qs = new URLSearchParams();
      if (opts.siteId) qs.set('siteId', opts.siteId);
      if (opts.limit !== undefined) qs.set('limit', String(opts.limit));
      const suffix = qs.toString() ? `?${qs.toString()}` : '';
      const raw = await apiRequest<unknown>(
        `/api/v1/mining/cost-engineer/snapshots${suffix}`,
        { signal },
      );
      return z.array(SnapshotRowSchema).parse(raw);
    },
    staleTime: 60_000,
  });
}
