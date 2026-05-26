'use client';

import { useQuery } from '@tanstack/react-query';
import { apiRequestOrFallback } from '@/lib/api-client';

export const sitesKeys = {
  list: () => ['sites', 'list'] as const,
  detail: (id: string) => ['sites', id] as const,
};

export interface MiningSite {
  readonly id: string;
  readonly name: string;
  readonly status?: string;
  readonly phase?: string;
  readonly licenceId?: string;
  readonly managerUserId?: string;
}

/**
 * Sites list.
 *
 * Live endpoint: GET /api/v1/mining/sites
 * (services/api-gateway/src/routes/mining/sites.hono.ts). Optional
 * `licenceId`, `phase`, `status` query filters are passed through.
 */
export function useSitesList(filters: {
  readonly licenceId?: string;
  readonly phase?: string;
  readonly status?: string;
} = {}) {
  return useQuery({
    queryKey: [...sitesKeys.list(), filters] as const,
    queryFn: ({ signal }) => {
      const params = new URLSearchParams();
      if (filters.licenceId) params.set('licenceId', filters.licenceId);
      if (filters.phase) params.set('phase', filters.phase);
      if (filters.status) params.set('status', filters.status);
      const qs = params.toString();
      return apiRequestOrFallback<ReadonlyArray<MiningSite>>(
        `/api/v1/mining/sites${qs ? `?${qs}` : ''}`,
        [],
        { signal },
      );
    },
    staleTime: 60_000,
  });
}

export function useSite(id: string) {
  return useQuery({
    queryKey: sitesKeys.detail(id),
    enabled: Boolean(id),
    queryFn: ({ signal }) =>
      apiRequestOrFallback<MiningSite | null>(
        `/api/v1/mining/sites/${encodeURIComponent(id)}`,
        null,
        { signal },
      ),
  });
}
