'use client';

import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { apiRequest } from '@/lib/api-client';

/**
 * Geology-advisor query hook — orebody interpretation advice off the live
 * mining BFF.
 *
 * Live endpoint: GET /api/v1/mining/geology-advisor/advice?siteId=...
 * (services/api-gateway/src/routes/mining/geology-advisor.hono.ts). The
 * gateway computes via the real `@borjie/geology-advisor` (compositing +
 * contained-metal stats + policy recommendations) over the tenant's
 * `samples` + `drill_hole_layers`. Tenant scope is bound server-side via
 * the RLS GUC; the `{ success, data }` envelope is unwrapped by
 * `apiRequest`, so the hook receives the inner payload directly.
 */

const EvidenceRefSchema = z.object({
  id: z.string(),
  kind: z.string(),
  pointer: z.string(),
});

const RecommendationSchema = z.object({
  id: z.string(),
  kind: z.string(),
  title: z.string(),
  rationale: z.string(),
  severity: z.enum(['info', 'low', 'medium', 'high', 'critical']),
  evidence: z.array(EvidenceRefSchema),
});
export type GeologyRecommendation = z.infer<typeof RecommendationSchema>;

const OreBodyStatsSchema = z.object({
  totalTonnes: z.number(),
  weightedAverageGrade: z.number(),
  containedMetalTonnes: z.number(),
  meanGradeAboveCutoff: z.number(),
  intervalCount: z.number(),
});
export type OreBodyStats = z.infer<typeof OreBodyStatsSchema>;

const AnalysisSchema = z.object({
  stats: OreBodyStatsSchema,
  computedAtISO: z.string(),
});

// The gateway returns `{ analysis, recommendations, evidenceIds, note? }`.
// On a degraded read `analysis` is null and the arrays are empty.
const AdviceSchema = z.object({
  analysis: AnalysisSchema.nullable().default(null),
  recommendations: z.array(RecommendationSchema).default([]),
  evidenceIds: z.array(z.string()).default([]),
  note: z.string().optional(),
});
export type GeologyAdvice = z.infer<typeof AdviceSchema>;

export const geologyAdvisorKeys = {
  advice: (siteId: string, element: string) =>
    ['geology-advisor', 'advice', siteId, element] as const,
};

export function useGeologyAdvice(opts: {
  readonly siteId: string | undefined;
  readonly element?: string;
  readonly cutoffGrade?: number;
}) {
  const element = opts.element ?? 'Au_g_t';
  return useQuery({
    enabled: Boolean(opts.siteId),
    queryKey: geologyAdvisorKeys.advice(opts.siteId ?? 'none', element),
    queryFn: async ({ signal }): Promise<GeologyAdvice> => {
      const qs = new URLSearchParams();
      qs.set('siteId', opts.siteId ?? '');
      qs.set('element', element);
      if (opts.cutoffGrade !== undefined) {
        qs.set('cutoffGrade', String(opts.cutoffGrade));
      }
      const raw = await apiRequest<unknown>(
        `/api/v1/mining/geology-advisor/advice?${qs.toString()}`,
        { signal },
      );
      return AdviceSchema.parse(raw);
    },
    staleTime: 60_000,
  });
}
