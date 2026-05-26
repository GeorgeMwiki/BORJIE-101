'use client';

import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api-client';
import type { SiteCockpitData } from '@/lib/types/site-cockpit';

export const siteCockpitKeys = {
  bySite: (siteId: string) => ['site-cockpit', siteId] as const,
};

export function useSiteCockpit(siteId: string) {
  return useQuery({
    queryKey: siteCockpitKeys.bySite(siteId),
    queryFn: ({ signal }) =>
      // Live endpoint: GET /api/v1/mining/sites/:id
      // (services/api-gateway/src/routes/mining/sites.hono.ts).
      apiRequest<SiteCockpitData>(
        `/api/v1/mining/sites/${encodeURIComponent(siteId)}`,
        { signal },
      ),
  });
}
