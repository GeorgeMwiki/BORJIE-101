'use client';

import { useQuery } from '@tanstack/react-query';
import { apiRequestOrFallback } from '@/lib/api-client';
import { cockpitMock, type DailyBriefResponse } from '@/lib/mocks/cockpit';

export const cockpitKeys = {
  all: ['cockpit'] as const,
  dailyBrief: () => [...cockpitKeys.all, 'daily-brief'] as const,
  cashRunway: () => [...cockpitKeys.all, 'cash-runway'] as const,
  cliffStatus: () => [...cockpitKeys.all, 'cliff-status'] as const,
  licenceHealth: () => [...cockpitKeys.all, 'licence-health'] as const,
  productionVsTarget: () => [...cockpitKeys.all, 'production-vs-target'] as const,
};

/**
 * Stale-while-revalidate fetch for the daily owner brief. Returns a
 * cached snapshot immediately while a fresh fetch runs in the
 * background; falls back to the bundled mock when the gateway is
 * unreachable so the dashboard never blanks.
 *
 * Live endpoint: GET /api/v1/mining/cockpit/daily-brief
 * (services/api-gateway/src/routes/mining/cockpit.hono.ts).
 */
export function useDailyBrief() {
  return useQuery({
    queryKey: cockpitKeys.dailyBrief(),
    queryFn: ({ signal }) =>
      apiRequestOrFallback<DailyBriefResponse>(
        '/api/v1/mining/cockpit/daily-brief',
        cockpitMock(),
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

const CASH_RUNWAY_FALLBACK: CashRunwaySummary = {
  ninetyDayNetTzs: 0,
  dailyAvgTzs: 0,
  sampleCount: 0,
  note: 'Mock fallback — runway compute requires the live ledger.',
};

export function useCashRunway() {
  return useQuery({
    queryKey: cockpitKeys.cashRunway(),
    queryFn: ({ signal }) =>
      apiRequestOrFallback<CashRunwaySummary>(
        '/api/v1/mining/cockpit/cash-runway',
        CASH_RUNWAY_FALLBACK,
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

const CLIFF_FALLBACK: CliffStatusSummary = {
  cliffDateIso: '2026-03-27T00:00:00.000Z',
  postCliffSales: 0,
  usdDenominated: 0,
  remediationComplete: false,
  note: 'Mock fallback — gateway unreachable.',
};

export function useCliffStatus() {
  return useQuery({
    queryKey: cockpitKeys.cliffStatus(),
    queryFn: ({ signal }) =>
      apiRequestOrFallback<CliffStatusSummary>(
        '/api/v1/mining/cockpit/27mar-cliff-status',
        CLIFF_FALLBACK,
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
      apiRequestOrFallback<ReadonlyArray<LicenceHealthRow>>(
        '/api/v1/mining/cockpit/licence-health',
        [],
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
      apiRequestOrFallback<ProductionVsTarget>(
        '/api/v1/mining/cockpit/production-vs-target',
        { window: '30d', perSite: [] },
        { signal },
      ),
    staleTime: 5 * 60_000,
  });
}
