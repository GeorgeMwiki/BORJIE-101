import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { MOCK_PROMPTS } from '@/lib/mocks/prompts';
import type { PromptRow, PromptStatus } from '@/lib/mocks/types';

const KEY = ['internal', 'prompts'] as const;

interface PromptsResult {
  readonly rows: ReadonlyArray<PromptRow>;
  readonly source: 'live' | 'mock';
}

export function usePromptsQuery() {
  return useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<PromptsResult> => {
      const res = await apiClient.get<ReadonlyArray<PromptRow>>('/prompts', async () => MOCK_PROMPTS);
      if (!res.ok) throw new Error(res.message);
      return { rows: res.data, source: res.source };
    },
  });
}

interface SetStatusInput {
  readonly id: string;
  readonly status: PromptStatus;
}

export function useSetPromptStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: SetStatusInput): Promise<PromptRow> => {
      const res = await apiClient.patch<PromptRow>(`/prompts/${id}/status`, { status }, async () => {
        const hit = MOCK_PROMPTS.find((p) => p.id === id);
        if (!hit) throw new Error('Prompt not found');
        return { ...hit, status };
      });
      if (!res.ok) throw new Error(res.message);
      return res.data;
    },
    onMutate: async ({ id, status }) => {
      await qc.cancelQueries({ queryKey: KEY });
      const prev = qc.getQueryData<PromptsResult>(KEY);
      if (prev) {
        qc.setQueryData<PromptsResult>(KEY, {
          ...prev,
          rows: prev.rows.map((p) => (p.id === id ? { ...p, status } : p)),
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
