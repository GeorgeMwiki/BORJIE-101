/**
 * react-query bindings for /api/v1/mining/internal/self-healing — the
 * INTERNAL-ADMIN self-healing console.
 *
 * Live endpoints (services/api-gateway/src/routes/mining/internal/self-healing.hono.ts):
 *   GET   /self-healing/proposals             open queue (pending + auto-healed)
 *   POST  /self-healing/proposals/:id/approve approve (fix accepted)
 *   POST  /self-healing/proposals/:id/deny    deny (degrade accepted)
 *
 * Each row carries the blocker's insight + action plan so the admin can triage
 * without leaving the screen. Live-only: failures surface on react-query's
 * `error` channel.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient, toApiError } from '@/lib/api-client';

const KEY = ['internal', 'self-healing', 'proposals'] as const;

export interface RepairProposalView {
  readonly id: string;
  readonly blockerKind: string;
  readonly repairClass: string;
  readonly locus: string;
  readonly detail: string | null;
  readonly title: string;
  readonly suggestedFix: string;
  readonly insight: string;
  readonly actionPlan: ReadonlyArray<string>;
  readonly autoApplicable: boolean;
  readonly tenantId: string | null;
  readonly occurrenceCount: number;
  readonly status: 'pending' | 'auto-healed' | 'approved' | 'denied';
  readonly needsApproval: boolean;
  readonly firstSeenAt: string | null;
  readonly lastSeenAt: string | null;
}

interface QueueResult {
  readonly rows: ReadonlyArray<RepairProposalView>;
  readonly source: 'live';
}

export function useSelfHealingQueueQuery() {
  return useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<QueueResult> => {
      const res = await apiClient.get<ReadonlyArray<RepairProposalView>>(
        '/self-healing/proposals',
      );
      if (!res.ok) throw toApiError(res);
      return { rows: res.data ?? [], source: 'live' };
    },
  });
}

interface DecisionInput {
  readonly id: string;
  readonly decision: 'approve' | 'deny';
  readonly note?: string;
}

export function useDecideRepairProposal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      decision,
      note,
    }: DecisionInput): Promise<{ readonly id: string }> => {
      const res = await apiClient.post<{ readonly id: string }>(
        `/self-healing/proposals/${id}/${decision}`,
        note ? { note } : {},
      );
      if (!res.ok) throw toApiError(res);
      return res.data;
    },
    onMutate: async ({ id }) => {
      await qc.cancelQueries({ queryKey: KEY });
      const prev = qc.getQueryData<QueueResult>(KEY);
      if (prev) {
        qc.setQueryData<QueueResult>(KEY, {
          ...prev,
          rows: prev.rows.filter((r) => r.id !== id),
        });
      }
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(KEY, ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
