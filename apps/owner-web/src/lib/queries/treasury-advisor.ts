'use client';

/**
 * FX & treasury advisor query/mutation hooks — backed by the live mining
 * BFF at `/api/v1/mining/fx-treasury/*`
 * (services/api-gateway/src/routes/mining/fx-treasury.hono.ts).
 *
 * The gateway computes via the real `@borjie/fx-treasury-advisor`
 * (day-by-day cash-runway projection with zero-crossing + min-balance →
 * multi-currency FX exposure netting → evidence-backed recommendations
 * incl. the 27-Mar USD-cliff remediation playbook) and PERSISTS each
 * analysis into the tenant-scoped `fx_snapshots` table.
 *
 * Every response is zod-validated before reaching a component. The
 * `{ success, data }` envelope is unwrapped by `apiRequest`.
 *
 * Currency is DATA, never hardcoded — this IS the FX domain. The runway
 * + exposure carry their own `baseCurrency` (ISO-4217), which the panel
 * threads into `formatCurrency`; all conversions use caller-supplied
 * `fxRates`.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { apiRequest } from '@/lib/api-client';

export const CURRENCY_CODES = ['TZS', 'USD', 'EUR', 'GBP'] as const;
export type CurrencyCode = (typeof CURRENCY_CODES)[number];

// ─── Response schemas (mirror @borjie/fx-treasury-advisor) ────────────

const RunwayPointSchema = z.object({
  dateISO: z.string(),
  balanceBase: z.number(),
  netFlowBase: z.number(),
});
export type RunwayPoint = z.infer<typeof RunwayPointSchema>;

const RunwayProjectionSchema = z.object({
  baseCurrency: z.enum(CURRENCY_CODES),
  horizonDays: z.number(),
  points: z.array(RunwayPointSchema),
  zeroCrossingISO: z.string().nullable(),
  minBalanceBase: z.number(),
});
export type RunwayProjection = z.infer<typeof RunwayProjectionSchema>;

const ExposureRowSchema = z.object({
  currency: z.enum(CURRENCY_CODES),
  netPosition: z.number(),
  netPositionBase: z.number(),
});
export type ExposureRow = z.infer<typeof ExposureRowSchema>;

const FxExposureSchema = z.object({
  baseCurrency: z.enum(CURRENCY_CODES),
  rows: z.array(ExposureRowSchema),
});
export type FxExposure = z.infer<typeof FxExposureSchema>;

const TreasuryAnalysisSchema = z.object({
  runway: RunwayProjectionSchema,
  exposure: FxExposureSchema,
  computedAtISO: z.string(),
});
export type TreasuryAnalysis = z.infer<typeof TreasuryAnalysisSchema>;

const AnalyzeResultSchema = z.object({
  analysis: TreasuryAnalysisSchema,
  persisted: z.boolean(),
  snapshotId: z.string().nullable(),
});
export type TreasuryAnalyzeResult = z.infer<typeof AnalyzeResultSchema>;

const EvidenceRefSchema = z.object({
  id: z.string(),
  kind: z.string(),
  pointer: z.string(),
});

const TreasuryRecommendationSchema = z.object({
  id: z.string(),
  kind: z.string(),
  title: z.string(),
  rationale: z.string(),
  severity: z.enum(['info', 'low', 'medium', 'high', 'critical']),
  estimatedImpact: z
    .object({ amount: z.number(), currency: z.enum(CURRENCY_CODES) })
    .optional(),
  evidence: z.array(EvidenceRefSchema).min(1),
});
export type TreasuryRecommendation = z.infer<typeof TreasuryRecommendationSchema>;

const RecommendResultSchema = z.object({
  recommendations: z.array(TreasuryRecommendationSchema),
});
export type TreasuryRecommendResult = z.infer<typeof RecommendResultSchema>;

const SnapshotRowSchema = z.object({
  id: z.string(),
  mode: z.string(),
  botRateTzsPerUsd: z.string().nullable(),
  summary: z.unknown(),
  computedAt: z.union([z.string(), z.date()]).optional(),
});
export type TreasurySnapshotRow = z.infer<typeof SnapshotRowSchema>;

// ─── Request payloads (mirror the advisor input schema) ───────────────

export type CashflowDirection = 'in' | 'out';
export type CashflowCategory =
  | 'payroll'
  | 'fuel'
  | 'royalty'
  | 'tax'
  | 'capex'
  | 'off-take'
  | 'loan-service'
  | 'other';

export interface CashBalanceInput {
  readonly accountId: string;
  readonly currency: CurrencyCode;
  readonly balance: number;
  readonly asOfISO: string;
}

export interface CashflowInput {
  readonly id: string;
  readonly direction: CashflowDirection;
  readonly dueISO: string;
  readonly amount: number;
  readonly currency: CurrencyCode;
  readonly category: CashflowCategory;
  readonly counterparty?: string;
}

export interface StockpileInput {
  readonly id: string;
  readonly tonnes: number;
  readonly estimatedSpotPricePerTonne: number;
  readonly ageDays: number;
}

export interface FxRateInput {
  readonly pair: string;
  readonly rate: number;
  readonly asOfISO: string;
}

export interface TreasuryAnalyzeRequest {
  readonly baseCurrency: CurrencyCode;
  readonly horizonDays?: number;
  readonly balances: ReadonlyArray<CashBalanceInput>;
  readonly cashflows: ReadonlyArray<CashflowInput>;
  readonly stockpiles?: ReadonlyArray<StockpileInput>;
  readonly fxRates?: ReadonlyArray<FxRateInput>;
  readonly usdCliffDateISO?: string;
}

export interface TreasuryPolicy {
  readonly minRunwayDays?: number;
  readonly maxSingleCurrencyExposureRatio?: number;
}

// ─── Query keys ───────────────────────────────────────────────────────

export const treasuryAdvisorKeys = {
  all: ['treasury-advisor'] as const,
  snapshots: () => ['treasury-advisor', 'snapshots'] as const,
};

// ─── Hooks ────────────────────────────────────────────────────────────

/** Project runway + exposure and persist the snapshot. */
export function useTreasuryAnalyze() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      body: TreasuryAnalyzeRequest,
    ): Promise<TreasuryAnalyzeResult> => {
      const raw = await apiRequest<unknown>('/api/v1/mining/fx-treasury/analyze', {
        method: 'POST',
        body,
      });
      return AnalyzeResultSchema.parse(raw);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: treasuryAdvisorKeys.all });
    },
  });
}

/** Derive evidence-backed treasury recommendations from an analysis. */
export function useTreasuryRecommend() {
  return useMutation({
    mutationFn: async (args: {
      readonly analysis: TreasuryAnalysis;
      readonly input: TreasuryAnalyzeRequest;
      readonly policy?: TreasuryPolicy;
    }): Promise<TreasuryRecommendResult> => {
      const raw = await apiRequest<unknown>('/api/v1/mining/fx-treasury/recommend', {
        method: 'POST',
        body: {
          analysis: args.analysis,
          input: args.input,
          policy: args.policy ?? {},
        },
      });
      return RecommendResultSchema.parse(raw);
    },
  });
}

/** List the tenant's recent persisted treasury analyses. */
export function useTreasurySnapshots(opts: { readonly limit?: number } = {}) {
  return useQuery({
    queryKey: treasuryAdvisorKeys.snapshots(),
    queryFn: async ({ signal }): Promise<ReadonlyArray<TreasurySnapshotRow>> => {
      const qs = new URLSearchParams();
      if (opts.limit !== undefined) qs.set('limit', String(opts.limit));
      const suffix = qs.toString() ? `?${qs.toString()}` : '';
      const raw = await apiRequest<unknown>(
        `/api/v1/mining/fx-treasury/snapshots${suffix}`,
        { signal },
      );
      return z.array(SnapshotRowSchema).parse(raw);
    },
    staleTime: 60_000,
  });
}
