import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { MOCK_COMPLIANCE_QUEUE } from '@/lib/mocks/compliance';
import type { ComplianceItem } from '@/lib/mocks/types';

const KEY = ['internal', 'compliance-queue'] as const;

interface QueueResult {
  readonly rows: ReadonlyArray<ComplianceItem>;
  readonly source: 'live' | 'mock';
}

export function useComplianceQueueQuery() {
  return useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<QueueResult> => {
      const res = await apiClient.get<ReadonlyArray<ComplianceItem>>(
        '/compliance-queue',
        async () => MOCK_COMPLIANCE_QUEUE
      );
      if (!res.ok) throw new Error(res.message);
      return { rows: res.data, source: res.source };
    },
  });
}

interface DecisionInput {
  readonly id: string;
  readonly decision: 'approve' | 'reject';
}

export function useResolveCompliance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, decision }: DecisionInput): Promise<{ readonly id: string }> => {
      const res = await apiClient.post<{ readonly id: string }>(
        `/compliance-queue/${id}/${decision}`,
        {},
        async () => ({ id })
      );
      if (!res.ok) throw new Error(res.message);
      return res.data;
    },
    onMutate: async ({ id }) => {
      await qc.cancelQueries({ queryKey: KEY });
      const prev = qc.getQueryData<QueueResult>(KEY);
      if (prev) {
        qc.setQueryData<QueueResult>(KEY, { ...prev, rows: prev.rows.filter((r) => r.id !== id) });
      }
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(KEY, ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
