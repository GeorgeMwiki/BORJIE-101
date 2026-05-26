// TODO(api-gateway): no live `/api/v1/mining/internal/promotions` route
// exists. The closest live primitive is `POST /prompts/promote` —
// rollback is not yet exposed. Both hooks will fall back to mocks.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { MOCK_PROMOTIONS } from '@/lib/mocks/rollback';
import type { PromotionRow } from '@/lib/mocks/types';

const KEY = ['internal', 'promotions'] as const;

interface PromotionsResult {
  readonly rows: ReadonlyArray<PromotionRow>;
  readonly source: 'live' | 'mock';
}

export function usePromotionsQuery() {
  return useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<PromotionsResult> => {
      const res = await apiClient.get<ReadonlyArray<PromotionRow>>('/promotions', async () => MOCK_PROMOTIONS);
      if (!res.ok) throw new Error(res.message);
      return { rows: res.data, source: res.source };
    },
  });
}

export function useRevertPromotion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<{ readonly id: string }> => {
      const res = await apiClient.post<{ readonly id: string }>(`/promotions/${id}/revert`, {}, async () => ({ id }));
      if (!res.ok) throw new Error(res.message);
      return res.data;
    },
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: KEY });
      const prev = qc.getQueryData<PromotionsResult>(KEY);
      if (prev) {
        qc.setQueryData<PromotionsResult>(KEY, {
          ...prev,
          rows: prev.rows.map((r) => (r.id === id ? { ...r, canRevert: false } : r)),
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
