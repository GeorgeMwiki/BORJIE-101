// TODO(api-gateway): no live `/api/v1/mining/internal/slo` endpoint
// exists yet. Until it does, this fetcher falls back to the bundled
// SLO mock on 404. The code path will start serving live data once
// the gateway exposes the route.
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
