import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { MOCK_SLO } from '@/lib/mocks/slo';
import type { SloMetric } from '@/lib/mocks/types';

const KEY = ['internal', 'slo'] as const;

interface SloResult {
  readonly rows: ReadonlyArray<SloMetric>;
  readonly source: 'live' | 'mock';
}

export function useSloQuery() {
  return useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<SloResult> => {
      const res = await apiClient.get<ReadonlyArray<SloMetric>>('/slo', async () => MOCK_SLO);
      if (!res.ok) throw new Error(res.message);
      return { rows: res.data, source: res.source };
    },
  });
}
