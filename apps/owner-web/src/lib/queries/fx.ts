'use client';

/**
 * FX rate queries — backed by `/api/v1/mining/fx/{latest,history}`.
 *
 * The api-gateway's fx-feed-cron worker writes new rows every 5 min,
 * so the latest query refreshes on a 60s SWR cadence; history is
 * cached longer because individual ticks rarely change a 60-point
 * sparkline visibly.
 */

import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api-client';

export const fxKeys = {
  all: ['fx'] as const,
  latest: () => [...fxKeys.all, 'latest'] as const,
  history: (pair: string, limit: number) =>
    [...fxKeys.all, 'history', pair, limit] as const,
};

export type FxPair = 'TZS_USD' | 'XAU_USD_AM' | 'XAU_USD_PM';

export interface FxLatestRate {
  readonly pair: FxPair;
  readonly rate: number;
  readonly source: string;
  readonly ts: string;
}

export interface FxLatestResponse {
  readonly rates: ReadonlyArray<FxLatestRate>;
  readonly degraded: boolean;
}

export interface FxHistoryPoint {
  readonly ts: string;
  readonly rate: number;
  readonly source: string;
}

export interface FxHistoryResponse {
  readonly pair: FxPair;
  readonly points: ReadonlyArray<FxHistoryPoint>;
  readonly degraded: boolean;
}

export function useFxLatest() {
  return useQuery({
    queryKey: fxKeys.latest(),
    queryFn: ({ signal }) =>
      apiRequest<FxLatestResponse>('/api/v1/mining/fx/latest', { signal }),
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
}

export function useFxHistory(pair: FxPair, limit = 60) {
  return useQuery({
    queryKey: fxKeys.history(pair, limit),
    queryFn: ({ signal }) =>
      apiRequest<FxHistoryResponse>(
        `/api/v1/mining/fx/history?pair=${encodeURIComponent(pair)}&limit=${limit}`,
        { signal },
      ),
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
  });
}
