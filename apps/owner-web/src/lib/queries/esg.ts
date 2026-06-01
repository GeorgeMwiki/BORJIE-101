'use client';

import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { apiRequest } from '@/lib/api-client';

/**
 * ESG query hook — community engagement (village meetings) off the live
 * mining BFF.
 *
 * Live endpoint: GET /api/v1/mining/esg/community (filter by status,
 * siteId) (services/api-gateway/src/routes/mining/esg.hono.ts). Tenant
 * scope is bound server-side via RLS; `apiRequest` unwraps the
 * `{ success, data }` envelope so the hook receives the row array.
 *
 * Rows are zod-parsed (defence in depth) so a wire-format drift surfaces
 * on react-query's error channel rather than crashing the panel.
 */

const CommunityMeetingRowSchema = z.object({
  id: z.string(),
  villageName: z.string(),
  meetingDate: z.string(),
  status: z.string(),
  attendees: z.number().nullable().default(null),
  siteId: z.string().nullable().default(null),
  chairedByName: z.string().nullable().default(null),
});

export type CommunityMeetingRow = z.infer<typeof CommunityMeetingRowSchema>;

const CommunityMeetingListSchema = z.array(CommunityMeetingRowSchema);

export const esgKeys = {
  community: (status?: string, siteId?: string) =>
    ['esg', 'community', status ?? 'all', siteId ?? 'all'] as const,
};

export function useEsgCommunity(opts?: {
  readonly status?: string;
  readonly siteId?: string;
  readonly limit?: number;
}) {
  return useQuery({
    queryKey: esgKeys.community(opts?.status, opts?.siteId),
    queryFn: async ({ signal }): Promise<ReadonlyArray<CommunityMeetingRow>> => {
      const qs = new URLSearchParams();
      if (opts?.status) qs.set('status', opts.status);
      if (opts?.siteId) qs.set('siteId', opts.siteId);
      qs.set('limit', String(opts?.limit ?? 50));
      const raw = await apiRequest<unknown>(
        `/api/v1/mining/esg/community?${qs.toString()}`,
        { signal },
      );
      return CommunityMeetingListSchema.parse(raw);
    },
    staleTime: 60_000,
  });
}
