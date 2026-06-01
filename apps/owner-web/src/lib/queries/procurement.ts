'use client';

import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { apiRequest } from '@/lib/api-client';

/**
 * Procurement query hook — procurement recommendations off the live
 * mining BFF.
 *
 * Live endpoint: GET /api/v1/mining/procurement/recommendations (filter
 * by siteId) (services/api-gateway/src/routes/mining/procurement.hono.ts).
 * Tenant scope is bound server-side via RLS; `apiRequest` unwraps the
 * `{ success, data }` envelope so the hook receives the row array.
 *
 * Rows are zod-parsed (defence in depth). `summary` is a free-form jsonb
 * object on the source table; we keep it as a record and let the panel
 * pull a short, safe headline (with an i18n fallback) for the table cell.
 */

const ProcurementRecommendationRowSchema = z.object({
  id: z.string(),
  siteId: z.string().nullable().default(null),
  summary: z.record(z.string(), z.unknown()).default({}),
  createdAt: z.string(),
});

export type ProcurementRecommendationRow = z.infer<
  typeof ProcurementRecommendationRowSchema
>;

const ProcurementRecommendationListSchema = z.array(
  ProcurementRecommendationRowSchema,
);

export const procurementKeys = {
  recommendations: (siteId?: string) =>
    ['procurement', 'recommendations', siteId ?? 'all'] as const,
};

export function useProcurementRecommendations(opts?: {
  readonly siteId?: string;
  readonly limit?: number;
}) {
  return useQuery({
    queryKey: procurementKeys.recommendations(opts?.siteId),
    queryFn: async ({
      signal,
    }): Promise<ReadonlyArray<ProcurementRecommendationRow>> => {
      const qs = new URLSearchParams();
      if (opts?.siteId) qs.set('siteId', opts.siteId);
      qs.set('limit', String(opts?.limit ?? 50));
      const raw = await apiRequest<unknown>(
        `/api/v1/mining/procurement/recommendations?${qs.toString()}`,
        { signal },
      );
      return ProcurementRecommendationListSchema.parse(raw);
    },
    staleTime: 60_000,
  });
}

/**
 * Pull a short, safe headline from a recommendation's free-form summary.
 * Falls back to the caller-supplied label when no recognised text field
 * is present so the table cell is never blank and never fabricated.
 */
export function procurementSummaryLabel(
  summary: Record<string, unknown>,
  fallback: string,
): string {
  for (const key of ['headline', 'title', 'summary', 'recommendation', 'label']) {
    const value = summary[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value;
    }
  }
  return fallback;
}
