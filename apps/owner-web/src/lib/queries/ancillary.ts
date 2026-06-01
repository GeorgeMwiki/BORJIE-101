'use client';

import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { apiRequest } from '@/lib/api-client';

/**
 * Ancillary query hook — side businesses off the live mining BFF.
 *
 * Live endpoint: GET /api/v1/mining/ancillary/businesses
 * (services/api-gateway/src/routes/mining/ancillary.hono.ts). The
 * endpoint is authed + RLS-bound and returns a real empty list today —
 * the ancillary-business domain table is not yet modelled, so the panel
 * renders a genuine "no records yet" state (never fabricated). The hook
 * is shaped for the eventual business row so wiring is a one-line change
 * the day the table lands.
 *
 * Rows are zod-parsed (defence in depth) so a wire-format drift surfaces
 * on react-query's error channel rather than crashing the panel.
 */

const AncillaryBusinessRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  sector: z.string().nullable().default(null),
  status: z.string().nullable().default(null),
  monthlyRevenue: z.string().nullable().default(null),
});

export type AncillaryBusinessRow = z.infer<typeof AncillaryBusinessRowSchema>;

const AncillaryBusinessListSchema = z.array(AncillaryBusinessRowSchema);

export const ancillaryKeys = {
  businesses: (status?: string) =>
    ['ancillary', 'businesses', status ?? 'all'] as const,
};

export function useAncillaryBusinesses(opts?: {
  readonly status?: string;
  readonly limit?: number;
}) {
  return useQuery({
    queryKey: ancillaryKeys.businesses(opts?.status),
    queryFn: async ({ signal }): Promise<ReadonlyArray<AncillaryBusinessRow>> => {
      const qs = new URLSearchParams();
      if (opts?.status) qs.set('status', opts.status);
      qs.set('limit', String(opts?.limit ?? 50));
      const raw = await apiRequest<unknown>(
        `/api/v1/mining/ancillary/businesses?${qs.toString()}`,
        { signal },
      );
      return AncillaryBusinessListSchema.parse(raw);
    },
    staleTime: 60_000,
  });
}
