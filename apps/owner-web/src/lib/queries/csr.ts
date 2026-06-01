'use client';

import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { apiRequest } from '@/lib/api-client';

/**
 * CSR query hook — community plans / pledges off the live mining BFF.
 *
 * Live endpoint: GET /api/v1/mining/csr-plans (filter by status, category,
 * siteId) (services/api-gateway/src/routes/mining/csr-plans.hono.ts).
 * Tenant scope is bound server-side via RLS; `apiRequest` unwraps the
 * `{ success, data }` envelope so the hook receives the row array.
 *
 * Rows are zod-parsed (defence in depth) so a wire-format drift surfaces
 * on react-query's error channel rather than crashing the panel.
 */

const CsrPlanRowSchema = z.object({
  id: z.string(),
  title: z.string(),
  category: z.string(),
  status: z.string(),
  siteId: z.string().nullable().default(null),
  villageId: z.string().nullable().default(null),
  createdAt: z.string(),
});

export type CsrPlanRow = z.infer<typeof CsrPlanRowSchema>;

const CsrPlanListSchema = z.array(CsrPlanRowSchema);

export const csrKeys = {
  plans: (status?: string, category?: string) =>
    ['csr', 'plans', status ?? 'all', category ?? 'all'] as const,
};

export function useCsrPlans(opts?: {
  readonly status?: string;
  readonly category?: string;
  readonly limit?: number;
}) {
  return useQuery({
    queryKey: csrKeys.plans(opts?.status, opts?.category),
    queryFn: async ({ signal }): Promise<ReadonlyArray<CsrPlanRow>> => {
      const qs = new URLSearchParams();
      if (opts?.status) qs.set('status', opts.status);
      if (opts?.category) qs.set('category', opts.category);
      qs.set('limit', String(opts?.limit ?? 50));
      const raw = await apiRequest<unknown>(
        `/api/v1/mining/csr-plans?${qs.toString()}`,
        { signal },
      );
      return CsrPlanListSchema.parse(raw);
    },
    staleTime: 60_000,
  });
}
