'use client';

import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api-client';
import type { DailyBriefResponse } from '@/lib/types/cockpit';

export const cockpitKeys = {
  all: ['cockpit'] as const,
  dailyBrief: () => [...cockpitKeys.all, 'daily-brief'] as const,
  cashRunway: () => [...cockpitKeys.all, 'cash-runway'] as const,
  cliffStatus: () => [...cockpitKeys.all, 'cliff-status'] as const,
  licenceHealth: () => [...cockpitKeys.all, 'licence-health'] as const,
  productionVsTarget: () => [...cockpitKeys.all, 'production-vs-target'] as const,
};

/**
 * Stale-while-revalidate fetch for the daily owner brief.
 *
 * Live endpoint: GET /api/v1/mining/cockpit/daily-brief
 * (services/api-gateway/src/routes/mining/cockpit.hono.ts).
 */
export function useDailyBrief() {
  return useQuery({
    queryKey: cockpitKeys.dailyBrief(),
    queryFn: ({ signal }) =>
      apiRequest<DailyBriefResponse>(
        '/api/v1/mining/cockpit/daily-brief',
        { signal },
      ),
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });
}

export interface CashRunwaySummary {
  readonly ninetyDayNetTzs: number;
  readonly dailyAvgTzs: number;
  readonly sampleCount: number;
  readonly note: string;
}

export function useCashRunway() {
  return useQuery({
    queryKey: cockpitKeys.cashRunway(),
    queryFn: ({ signal }) =>
      apiRequest<CashRunwaySummary>(
        '/api/v1/mining/cockpit/cash-runway',
        { signal },
      ),
    staleTime: 60_000,
  });
}

export interface CliffStatusSummary {
  readonly cliffDateIso: string;
  readonly postCliffSales: number;
  readonly usdDenominated: number;
  readonly remediationComplete: boolean;
  readonly note: string;
}

export function useCliffStatus() {
  return useQuery({
    queryKey: cockpitKeys.cliffStatus(),
    queryFn: ({ signal }) =>
      apiRequest<CliffStatusSummary>(
        '/api/v1/mining/cockpit/27mar-cliff-status',
        { signal },
      ),
    staleTime: 5 * 60_000,
  });
}

export interface LicenceHealthRow {
  readonly id: string;
  readonly daysToExpiry: number | null;
  readonly atRisk: boolean;
  readonly dormancyScore?: number;
  readonly kind?: string;
  readonly mineral?: string;
}

export function useLicenceHealth() {
  return useQuery({
    queryKey: cockpitKeys.licenceHealth(),
    queryFn: ({ signal }) =>
      apiRequest<ReadonlyArray<LicenceHealthRow>>(
        '/api/v1/mining/cockpit/licence-health',
        { signal },
      ),
    staleTime: 5 * 60_000,
  });
}

export interface ProductionVsTarget {
  readonly window: string;
  readonly perSite: ReadonlyArray<{
    readonly siteId: string;
    readonly tonnes: number;
    readonly fuel: number;
    readonly shifts: number;
  }>;
}

export function useProductionVsTarget() {
  return useQuery({
    queryKey: cockpitKeys.productionVsTarget(),
    queryFn: ({ signal }) =>
      apiRequest<ProductionVsTarget>(
        '/api/v1/mining/cockpit/production-vs-target',
        { signal },
      ),
    staleTime: 5 * 60_000,
  });
}
