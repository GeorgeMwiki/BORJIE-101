'use client';

import { useQuery } from '@tanstack/react-query';
import { apiRequestOrFallback } from '@/lib/api-client';
import { cockpitMock, type DailyBriefResponse } from '@/lib/mocks/cockpit';

export const cockpitKeys = {
  all: ['cockpit'] as const,
  dailyBrief: () => [...cockpitKeys.all, 'daily-brief'] as const,
};

/**
 * Stale-while-revalidate fetch for the daily owner brief. Returns a
 * cached snapshot immediately while a fresh fetch runs in the
 * background; falls back to the bundled mock when the gateway is
 * unreachable so the dashboard never blanks.
 */
export function useDailyBrief() {
  return useQuery({
    queryKey: cockpitKeys.dailyBrief(),
    queryFn: ({ signal }) =>
      apiRequestOrFallback<DailyBriefResponse>(
        '/api/v1/owner/cockpit/daily-brief',
        cockpitMock(),
        { signal },
      ),
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });
}
