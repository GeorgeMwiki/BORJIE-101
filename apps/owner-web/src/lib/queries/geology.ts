'use client';

import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { apiRequest } from '@/lib/api-client';

/**
 * Geology query hooks — drill holes off the live mining BFF.
 *
 * Live endpoint: GET /api/v1/mining/drill-holes (filter by siteId, kind)
 * (services/api-gateway/src/routes/mining/drill-holes.hono.ts). Tenant
 * scope is bound server-side via the `app.tenant_id` GUC + RLS; the
 * gateway's `{ success, data }` envelope is unwrapped by `apiRequest`, so
 * the hook receives the row array directly.
 */

// Defence-in-depth: parse the gateway payload so a wire-format drift
// surfaces on react-query's error channel instead of crashing the panel.
// Unknown extra keys are stripped (zod default), nullable numerics stay
// strings (the gateway serialises numeric columns as strings).
const DrillHoleRowSchema = z.object({
  id: z.string(),
  siteId: z.string(),
  holeIdExternal: z.string(),
  collarLocation: z.string().nullable().default(null),
  azimuthDeg: z.string().nullable().default(null),
  dipDeg: z.string().nullable().default(null),
  totalDepthM: z.string().nullable().default(null),
  createdAt: z.string(),
});

export type DrillHoleRow = z.infer<typeof DrillHoleRowSchema>;

const DrillHoleListSchema = z.array(DrillHoleRowSchema);

export const geologyKeys = {
  drillHoles: (siteId?: string) =>
    ['geology', 'drill-holes', siteId ?? 'all'] as const,
};

export function useDrillHoles(opts?: {
  readonly siteId?: string;
  readonly limit?: number;
}) {
  return useQuery({
    queryKey: geologyKeys.drillHoles(opts?.siteId),
    queryFn: async ({ signal }): Promise<ReadonlyArray<DrillHoleRow>> => {
      const qs = new URLSearchParams();
      if (opts?.siteId) qs.set('siteId', opts.siteId);
      qs.set('limit', String(opts?.limit ?? 50));
      const raw = await apiRequest<unknown>(
        `/api/v1/mining/drill-holes?${qs.toString()}`,
        { signal },
      );
      return DrillHoleListSchema.parse(raw);
    },
    staleTime: 60_000,
  });
}
