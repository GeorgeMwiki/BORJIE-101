'use client';

import { useMutation } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api-client';

/**
 * Owner-cockpit data hooks for the capacity-expansion advisor.
 *
 * Backed by `/api/v1/mining/capacity-expansion/*` (gateway route wrapping
 * the pure-compute `@borjie/capacity-expansion-advisor` package):
 *   - useExpansionAnalyze   → POST /analyze    (NPV / IRR / payback + rank)
 *   - useExpansionRecommend → POST /recommend  (evidence-cited advice)
 *
 * LIVE-ONLY: failures land on the react-query error channel.
 */

export type CurrencyCode = 'TZS' | 'USD' | 'EUR' | 'GBP';
export type ExpansionKind = 'new-shaft' | 'new-site' | 'processing-upgrade';

export interface ExpansionScenarioInput {
  readonly id: string;
  readonly kind: ExpansionKind;
  readonly label: string;
  readonly upfrontCapex: number;
  readonly incrementalCashflows: ReadonlyArray<number>;
  readonly incrementalTonnesPerYear?: number;
  readonly description?: string;
}

export interface ExpansionAnalyzeInput {
  readonly currency: CurrencyCode;
  readonly discountRate: number;
  readonly scenarios: ReadonlyArray<ExpansionScenarioInput>;
}

export interface ScenarioOutcome {
  readonly id: string;
  readonly kind: ExpansionKind;
  readonly label: string;
  readonly npv: number;
  readonly irr: number | null;
  readonly paybackYears: number | null;
  readonly totalIncrementalTonnes: number;
  readonly upfrontCapex: number;
}

export interface ExpansionAnalysis {
  readonly currency: CurrencyCode;
  readonly discountRate: number;
  readonly outcomes: ReadonlyArray<ScenarioOutcome>;
  readonly rankedByNpv: ReadonlyArray<string>;
  readonly computedAtISO: string;
}

export interface EvidenceRef {
  readonly id: string;
  readonly kind: 'scenario' | 'cashflow' | 'capex';
  readonly pointer: string;
}

export interface ExpansionRecommendation {
  readonly id: string;
  readonly scenarioId: string;
  readonly title: string;
  readonly rationale: string;
  readonly severity: 'info' | 'low' | 'medium' | 'high' | 'critical';
  readonly evidence: ReadonlyArray<EvidenceRef>;
}

export interface ExpansionRecommendationContext {
  readonly analysis: ExpansionAnalysis;
  readonly policy?: {
    readonly minNpv?: number;
    readonly maxPaybackYears?: number;
  };
}

/** Score + rank a set of expansion scenarios. */
export function useExpansionAnalyze() {
  return useMutation({
    mutationFn: (input: ExpansionAnalyzeInput) =>
      apiRequest<{ readonly analysis: ExpansionAnalysis }>(
        '/api/v1/mining/capacity-expansion/analyze',
        { method: 'POST', body: input },
      ),
  });
}

/** Derive evidence-cited recommendations from an analysis + policy floor. */
export function useExpansionRecommend() {
  return useMutation({
    mutationFn: (context: ExpansionRecommendationContext) =>
      apiRequest<{
        readonly recommendations: ReadonlyArray<ExpansionRecommendation>;
        readonly count: number;
      }>('/api/v1/mining/capacity-expansion/recommend', {
        method: 'POST',
        body: context,
      }),
  });
}
