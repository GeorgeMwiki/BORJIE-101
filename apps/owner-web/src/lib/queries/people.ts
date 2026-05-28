'use client';

import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api-client';

export interface HeadcountSite {
  readonly siteId: string | null;
  readonly headcount: number;
}

export interface HeadcountResponse {
  readonly groupBy: 'site';
  readonly perSite: ReadonlyArray<HeadcountSite>;
}

export const peopleKeys = {
  headcount: (workDate?: string) => ['people', 'headcount', workDate ?? 'today'] as const,
};

/**
 * Live attendance headcount roll-up. Backs the workforce KPI tile on
 * the People surface; defaults to today and groups by site.
 *
 * Endpoint: GET /api/v1/mining/attendance/headcount
 */
export function useHeadcount(workDate?: string) {
  return useQuery({
    queryKey: peopleKeys.headcount(workDate),
    queryFn: ({ signal }) => {
      const qs = workDate ? `?workDate=${encodeURIComponent(workDate)}` : '';
      return apiRequest<HeadcountResponse>(
        `/api/v1/mining/attendance/headcount${qs}`,
        { signal },
      );
    },
    staleTime: 60_000,
  });
}
