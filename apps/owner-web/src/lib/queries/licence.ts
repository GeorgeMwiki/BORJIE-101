'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api-client';
import type { LicenceCockpitData } from '@/lib/types/licence';

export const licenceKeys = {
  list: () => ['licences', 'list'] as const,
  cockpit: (id: string) => ['licence', id, 'cockpit'] as const,
};

/**
 * Licence cockpit fetch.
 *
 * Live endpoint: GET /api/v1/mining/licences/:id
 * (services/api-gateway/src/routes/mining/licences.hono.ts). The
 * gateway is expected to return the full LicenceCockpitData
 * projection (derived dormancy + payments + renewal pack progress).
 */
export function useLicenceCockpit(id: string) {
  return useQuery({
    queryKey: licenceKeys.cockpit(id),
    queryFn: ({ signal }) =>
      apiRequest<LicenceCockpitData>(
        `/api/v1/mining/licences/${encodeURIComponent(id)}`,
        { signal },
      ),
  });
}

export function useLicencesList() {
  return useQuery({
    queryKey: licenceKeys.list(),
    queryFn: ({ signal }) =>
      apiRequest<ReadonlyArray<unknown>>('/api/v1/mining/licences', { signal }),
  });
}

/**
 * Trigger a licence-renewal pack generation job. Wraps the live
 * `POST /licences/:id/renew` endpoint; resolves with the download URL
 * the toast points to.
 */
export function useGenerateRenewalPack() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { readonly licenceId: string }) =>
      apiRequest<{ url: string; id: string }>(
        `/api/v1/mining/licences/${encodeURIComponent(input.licenceId)}/renew`,
        { method: 'POST', body: { confirm: true } },
      ),
    onSuccess: (_, variables) => {
      client.invalidateQueries({ queryKey: licenceKeys.cockpit(variables.licenceId) });
    },
  });
}
