'use client';

import { useQuery } from '@tanstack/react-query';
import { apiRequestOrFallback } from '@/lib/api-client';
import { SITE_COCKPIT_MOCK, type SiteCockpitData } from '@/lib/mocks/site-cockpit';

export const siteCockpitKeys = {
  bySite: (siteId: string) => ['site-cockpit', siteId] as const,
};

export function useSiteCockpit(siteId: string) {
  return useQuery({
    queryKey: siteCockpitKeys.bySite(siteId),
    queryFn: ({ signal }) =>
      // Live endpoint: GET /api/v1/mining/sites/:id
      // (services/api-gateway/src/routes/mining/sites.hono.ts). The
      // gateway returns a flat site row; the UI's SiteCockpitData
      // overlays derived KPIs from the bundled mock until the live
      // projection lands (TODO).
      apiRequestOrFallback<SiteCockpitData>(
        `/api/v1/mining/sites/${encodeURIComponent(siteId)}`,
        SITE_COCKPIT_MOCK,
        { signal },
      ),
  });
}
