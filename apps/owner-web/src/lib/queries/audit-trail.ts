'use client';

import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { apiRequest } from '@/lib/api-client';

/**
 * Audit-trail query hook — the hash-chained, append-only ledger.
 *
 * Live endpoint: GET /api/v1/audit-trail/entries (filter by subjectType /
 * subjectId / from / to / category / actorKind)
 * (services/api-gateway/src/routes/audit-trail.router.ts). Requires
 * tenant-admin+; degrades to an in-memory repo when DATABASE_URL is unset
 * so the surface is always live.
 *
 * `apiRequest` unwraps the gateway `{ success, data }` envelope, so the
 * hook receives the entry array directly. The rows are zod-parsed
 * (defence in depth) so a wire-format drift surfaces on react-query's
 * error channel rather than crashing the panel.
 */

const AuditEntryRowSchema = z.object({
  id: z.string(),
  occurredAt: z.string(),
  actorKind: z.string(),
  actorDisplay: z.string().nullable().default(null),
  actionKind: z.string(),
  actionCategory: z.string(),
  subjectEntityType: z.string().nullable().default(null),
  subjectEntityId: z.string().nullable().default(null),
});

export type AuditEntryRow = z.infer<typeof AuditEntryRowSchema>;

const AuditEntryListSchema = z.array(AuditEntryRowSchema);

export const auditTrailKeys = {
  entries: (subjectType?: string, subjectId?: string) =>
    ['audit-trail', 'entries', subjectType ?? 'all', subjectId ?? 'all'] as const,
};

export function useAuditEntries(opts?: {
  readonly subjectType?: string;
  readonly subjectId?: string;
  readonly limit?: number;
}) {
  return useQuery({
    queryKey: auditTrailKeys.entries(opts?.subjectType, opts?.subjectId),
    queryFn: async ({ signal }): Promise<ReadonlyArray<AuditEntryRow>> => {
      const qs = new URLSearchParams();
      if (opts?.subjectType) qs.set('subjectType', opts.subjectType);
      if (opts?.subjectId) qs.set('subjectId', opts.subjectId);
      qs.set('limit', String(opts?.limit ?? 50));
      const raw = await apiRequest<unknown>(
        `/api/v1/audit-trail/entries?${qs.toString()}`,
        { signal },
      );
      return AuditEntryListSchema.parse(raw);
    },
    staleTime: 30_000,
  });
}
