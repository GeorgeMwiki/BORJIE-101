'use client';

import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { apiRequest } from '@/lib/api-client';

/**
 * Mine-planner-advisor query hook — 24h shift-plan advice off the live
 * mining BFF.
 *
 * Live endpoint: GET /api/v1/mining/mine-planner/advice?siteId=...
 * (services/api-gateway/src/routes/mining/mine-planner.hono.ts). The
 * gateway computes via the real `@borjie/mine-planner-advisor` (greedy
 * polygon→equipment→crew matcher → per-shift tonnage / hours / opex +
 * skill-gap recommendations) over the tenant's `ore_parcels` + `assets`.
 * Tenant scope is bound server-side via the RLS GUC; the
 * `{ success, data }` envelope is unwrapped by `apiRequest`.
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
export type PlanRecommendation = z.infer<typeof RecommendationSchema>;

const TaskAssignmentSchema = z.object({
  polygonId: z.string(),
  shift: z.enum(['morning', 'afternoon', 'night']),
  equipmentId: z.string(),
  crewIds: z.array(z.string()),
  estimatedTonnes: z.number(),
  estimatedHours: z.number(),
  estimatedOpex: z.number(),
});
export type TaskAssignment = z.infer<typeof TaskAssignmentSchema>;

const ShiftPlanSchema = z.object({
  siteId: z.string(),
  planDateISO: z.string(),
  assignments: z.array(TaskAssignmentSchema),
  totalEstimatedTonnes: z.number(),
  totalEstimatedOpex: z.number(),
  unmetTonnes: z.number(),
});
export type ShiftPlan = z.infer<typeof ShiftPlanSchema>;

const AdviceSchema = z.object({
  plan: ShiftPlanSchema.nullable().default(null),
  recommendations: z.array(RecommendationSchema).default([]),
  evidenceIds: z.array(z.string()).default([]),
  note: z.string().optional(),
});
export type MinePlannerAdvice = z.infer<typeof AdviceSchema>;

export const minePlannerAdvisorKeys = {
  advice: (siteId: string) => ['mine-planner-advisor', 'advice', siteId] as const,
};

export function useMinePlannerAdvice(opts: {
  readonly siteId: string | undefined;
  readonly targetTonnesPerDay?: number;
}) {
  return useQuery({
    enabled: Boolean(opts.siteId),
    queryKey: minePlannerAdvisorKeys.advice(opts.siteId ?? 'none'),
    queryFn: async ({ signal }): Promise<MinePlannerAdvice> => {
      const qs = new URLSearchParams();
      qs.set('siteId', opts.siteId ?? '');
      if (opts.targetTonnesPerDay !== undefined) {
        qs.set('targetTonnesPerDay', String(opts.targetTonnesPerDay));
      }
      const raw = await apiRequest<unknown>(
        `/api/v1/mining/mine-planner/advice?${qs.toString()}`,
        { signal },
      );
      return AdviceSchema.parse(raw);
    },
    staleTime: 60_000,
  });
}
