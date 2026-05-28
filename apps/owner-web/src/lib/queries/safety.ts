'use client';

import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api-client';

export interface IncidentRow {
  readonly id: string;
  readonly siteId: string | null;
  readonly kind: string;
  readonly severity: string;
  readonly occurredAt: string | null;
  readonly status: string;
  readonly description?: string | null;
}

export const safetyKeys = {
  incidents: (filters: Record<string, string> = {}) =>
    ['safety', 'incidents', filters] as const,
};

/**
 * Live incidents list from `GET /api/v1/mining/incidents`. Used by
 * the safety surface to render the open-incidents queue and severity
 * roll-up; defaults to the most-recent 200 rows.
 */
export function useIncidents(filters: {
  readonly siteId?: string;
  readonly severity?: 'low' | 'medium' | 'high' | 'critical';
  readonly status?: 'open' | 'closed';
  readonly kind?: string;
  readonly limit?: number;
} = {}) {
  return useQuery({
    queryKey: safetyKeys.incidents(
      Object.fromEntries(
        Object.entries(filters).filter(([, v]) => v !== undefined),
      ) as Record<string, string>,
    ),
    queryFn: ({ signal }) => {
      const params = new URLSearchParams();
      if (filters.siteId) params.set('siteId', filters.siteId);
      if (filters.severity) params.set('severity', filters.severity);
      if (filters.status) params.set('status', filters.status);
      if (filters.kind) params.set('kind', filters.kind);
      if (filters.limit) params.set('limit', String(filters.limit));
      const qs = params.toString();
      return apiRequest<ReadonlyArray<IncidentRow>>(
        `/api/v1/mining/incidents${qs ? `?${qs}` : ''}`,
        { signal },
      );
    },
    staleTime: 60_000,
  });
}
