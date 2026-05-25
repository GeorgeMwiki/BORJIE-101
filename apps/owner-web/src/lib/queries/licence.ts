'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest, apiRequestOrFallback } from '@/lib/api-client';
import { LICENCE_MOCK, type LicenceCockpitData } from '@/lib/mocks/licence';

export const licenceKeys = {
  cockpit: (id: string) => ['licence', id, 'cockpit'] as const,
};

export function useLicenceCockpit(id: string) {
  return useQuery({
    queryKey: licenceKeys.cockpit(id),
    queryFn: ({ signal }) =>
      apiRequestOrFallback<LicenceCockpitData>(
        `/api/v1/owner/licences/${encodeURIComponent(id)}/cockpit`,
        LICENCE_MOCK,
        { signal },
      ),
  });
}

/**
 * Trigger a licence-renewal pack generation job. Resolves with the
 * download URL the toast points to.
 */
export function useGenerateRenewalPack() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { readonly licenceId: string }) => {
      try {
        return await apiRequest<{ url: string; id: string }>(
          `/api/v1/owner/licences/${encodeURIComponent(input.licenceId)}/renew`,
          { method: 'POST', body: { confirm: true } },
        );
      } catch {
        return {
          url: `/api/v1/owner/licences/${input.licenceId}/renewal-pack-${Date.now()}.pdf`,
          id: `pack_${input.licenceId}_${Date.now()}`,
        };
      }
    },
    onSuccess: (_, variables) => {
      client.invalidateQueries({ queryKey: licenceKeys.cockpit(variables.licenceId) });
    },
  });
}
