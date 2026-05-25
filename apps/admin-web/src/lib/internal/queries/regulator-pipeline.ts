import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { MOCK_REGULATOR_PIPELINE } from '@/lib/mocks/regulator-pipeline';
import type { RegulatorChange, RegulatorStage } from '@/lib/mocks/types';

const KEY = ['internal', 'regulator-pipeline'] as const;

interface PipelineResult {
  readonly rows: ReadonlyArray<RegulatorChange>;
  readonly source: 'live' | 'mock';
}

export function useRegulatorPipelineQuery() {
  return useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<PipelineResult> => {
      const res = await apiClient.get<ReadonlyArray<RegulatorChange>>(
        '/regulator-pipeline',
        async () => MOCK_REGULATOR_PIPELINE
      );
      if (!res.ok) throw new Error(res.message);
      return { rows: res.data, source: res.source };
    },
  });
}

interface MoveInput {
  readonly id: string;
  readonly stage: RegulatorStage;
}

export function useMoveRegulatorChange() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, stage }: MoveInput): Promise<RegulatorChange> => {
      const res = await apiClient.patch<RegulatorChange>(
        `/regulator-pipeline/${id}/stage`,
        { stage },
        async () => {
          const hit = MOCK_REGULATOR_PIPELINE.find((r) => r.id === id);
          if (!hit) throw new Error('Change not found');
          return { ...hit, stage };
        }
      );
      if (!res.ok) throw new Error(res.message);
      return res.data;
    },
    onMutate: async ({ id, stage }) => {
      await qc.cancelQueries({ queryKey: KEY });
      const prev = qc.getQueryData<PipelineResult>(KEY);
      if (prev) {
        qc.setQueryData<PipelineResult>(KEY, {
          ...prev,
          rows: prev.rows.map((r) => (r.id === id ? { ...r, stage } : r)),
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
