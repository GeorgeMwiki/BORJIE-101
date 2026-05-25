import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { MOCK_KILLSWITCH } from '@/lib/mocks/killswitch';
import type { KillswitchRow, SwitchState } from '@/lib/mocks/types';

const KEY = ['internal', 'killswitch'] as const;

interface KillswitchResult {
  readonly rows: ReadonlyArray<KillswitchRow>;
  readonly source: 'live' | 'mock';
}

export function useKillswitchQuery() {
  return useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<KillswitchResult> => {
      const res = await apiClient.get<ReadonlyArray<KillswitchRow>>('/killswitch', async () => MOCK_KILLSWITCH);
      if (!res.ok) throw new Error(res.message);
      return { rows: res.data, source: res.source };
    },
  });
}

interface SetStateInput {
  readonly juniorId: string;
  readonly state: SwitchState;
  readonly firstOperatorId: string;
  readonly secondOperatorId: string;
}

export function useSetKillswitch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: SetStateInput): Promise<KillswitchRow> => {
      const res = await apiClient.post<KillswitchRow>(
        `/killswitch/${input.juniorId}`,
        {
          state: input.state,
          first: input.firstOperatorId,
          second: input.secondOperatorId,
        },
        async () => {
          const hit = MOCK_KILLSWITCH.find((k) => k.juniorId === input.juniorId);
          if (!hit) throw new Error('Junior not found');
          return {
            ...hit,
            state: input.state,
            updatedAt: new Date().toISOString(),
            updatedBy: `${input.firstOperatorId}+${input.secondOperatorId}`,
          };
        }
      );
      if (!res.ok) throw new Error(res.message);
      return res.data;
    },
    onSuccess: (next) => {
      const prev = qc.getQueryData<KillswitchResult>(KEY);
      if (prev) {
        qc.setQueryData<KillswitchResult>(KEY, {
          ...prev,
          rows: prev.rows.map((r) => (r.juniorId === next.juniorId ? next : r)),
        });
      } else {
        qc.invalidateQueries({ queryKey: KEY });
      }
    },
  });
}
