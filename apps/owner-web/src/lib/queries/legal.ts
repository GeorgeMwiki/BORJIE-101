'use client';

import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { apiRequest } from '@/lib/api-client';

/**
 * Legal query hook — contracts library off the live mining BFF.
 *
 * Live endpoint: GET /api/v1/mining/legal/contracts
 * (services/api-gateway/src/routes/mining/legal.hono.ts). The endpoint is
 * authed + RLS-bound and returns a real empty list today — the
 * contracts-library domain table is not yet modelled, so the panel
 * renders a genuine "no records yet" state (never fabricated). The hook
 * is shaped for the eventual contract row so wiring is a one-line change
 * the day the table lands.
 *
 * Rows are zod-parsed (defence in depth) so a wire-format drift surfaces
 * on react-query's error channel rather than crashing the panel.
 */

const LegalContractRowSchema = z.object({
  id: z.string(),
  title: z.string(),
  counterparty: z.string().nullable().default(null),
  status: z.string().nullable().default(null),
  effectiveAt: z.string().nullable().default(null),
});

export type LegalContractRow = z.infer<typeof LegalContractRowSchema>;

const LegalContractListSchema = z.array(LegalContractRowSchema);

export const legalKeys = {
  contracts: (status?: string) => ['legal', 'contracts', status ?? 'all'] as const,
};

export function useLegalContracts(opts?: {
  readonly status?: string;
  readonly limit?: number;
}) {
  return useQuery({
    queryKey: legalKeys.contracts(opts?.status),
    queryFn: async ({ signal }): Promise<ReadonlyArray<LegalContractRow>> => {
      const qs = new URLSearchParams();
      if (opts?.status) qs.set('status', opts.status);
      qs.set('limit', String(opts?.limit ?? 50));
      const raw = await apiRequest<unknown>(
        `/api/v1/mining/legal/contracts?${qs.toString()}`,
        { signal },
      );
      return LegalContractListSchema.parse(raw);
    },
    staleTime: 60_000,
  });
}
