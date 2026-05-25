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
      apiRequestOrFallback<SiteCockpitData>(
        `/api/v1/owner/sites/${encodeURIComponent(siteId)}/cockpit`,
        SITE_COCKPIT_MOCK,
        { signal },
      ),
  });
}
