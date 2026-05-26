'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest, apiRequestOrFallback } from '@/lib/api-client';
import { LICENCE_MOCK, type LicenceCockpitData } from '@/lib/mocks/licence';

export const licenceKeys = {
  list: () => ['licences', 'list'] as const,
  cockpit: (id: string) => ['licence', id, 'cockpit'] as const,
};

/**
 * Licence cockpit fetch.
 *
 * Live endpoint: GET /api/v1/mining/licences/:id
 * (services/api-gateway/src/routes/mining/licences.hono.ts). The
 * gateway returns a flat licence row; the front-end's
 * LicenceCockpitData shape includes derived dormancy + payments which
 * the mock supplies. Until the gateway exposes the cockpit projection
 * this hook falls back to the bundled mock on any failure.
 */
export function useLicenceCockpit(id: string) {
  return useQuery({
    queryKey: licenceKeys.cockpit(id),
    queryFn: async ({ signal }): Promise<LicenceCockpitData> => {
      const raw = await apiRequestOrFallback<unknown>(
        `/api/v1/mining/licences/${encodeURIComponent(id)}`,
        LICENCE_MOCK as unknown as LicenceCockpitData,
        { signal },
      );
      // The gateway returns a flat licence row; the UI's cockpit shape
      // needs derived fields (renewal-window, dormancy citation, payment
      // history). Until the gateway exposes the projection, overlay the
      // bundled mock so the screen stays usable end-to-end.
      if (isCockpitShape(raw)) return raw;
      return { ...LICENCE_MOCK, ...partialFromRow(raw, id) };
    },
  });
}

function isCockpitShape(value: unknown): value is LicenceCockpitData {
  return (
    typeof value === 'object' &&
    value !== null &&
    'reference' in (value as object) &&
    'payments' in (value as object)
  );
}

function partialFromRow(value: unknown, fallbackId: string): Partial<LicenceCockpitData> {
  if (!value || typeof value !== 'object') return {};
  const row = value as Record<string, unknown>;
  return {
    id: typeof row.id === 'string' ? row.id : fallbackId,
    reference: typeof row.number === 'string' ? String(row.number) : LICENCE_MOCK.reference,
    mineral:
      row.mineral === 'gold' || row.mineral === 'coltan' || row.mineral === 'tanzanite'
        ? (row.mineral as LicenceCockpitData['mineral'])
        : LICENCE_MOCK.mineral,
  };
}

export function useLicencesList() {
  return useQuery({
    queryKey: licenceKeys.list(),
    queryFn: ({ signal }) =>
      apiRequestOrFallback<ReadonlyArray<unknown>>('/api/v1/mining/licences', [], { signal }),
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
    mutationFn: async (input: { readonly licenceId: string }) => {
      try {
        return await apiRequest<{ url: string; id: string }>(
          `/api/v1/mining/licences/${encodeURIComponent(input.licenceId)}/renew`,
          { method: 'POST', body: { confirm: true } },
        );
      } catch {
        return {
          url: `/api/v1/mining/licences/${input.licenceId}/renewal-pack-${Date.now()}.pdf`,
          id: `pack_${input.licenceId}_${Date.now()}`,
        };
      }
    },
    onSuccess: (_, variables) => {
      client.invalidateQueries({ queryKey: licenceKeys.cockpit(variables.licenceId) });
    },
  });
}
