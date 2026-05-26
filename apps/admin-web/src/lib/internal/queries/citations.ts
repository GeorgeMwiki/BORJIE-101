// TODO(api-gateway): no live `/api/v1/mining/internal/citations`
// endpoint exists. Closest live primitive is the per-tenant corpus
// chunk row (intelligence_corpus_chunks). Falls back to mock.
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { MOCK_CITATIONS } from '@/lib/mocks/citations';
import type { Citation } from '@/lib/mocks/types';

const KEY = ['internal', 'citations'] as const;

interface CitationsResult {
  readonly rows: ReadonlyArray<Citation>;
  readonly source: 'live' | 'mock';
}

export function useCitationsQuery() {
  return useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<CitationsResult> => {
      const res = await apiClient.get<ReadonlyArray<Citation>>('/citations', async () => MOCK_CITATIONS);
      if (!res.ok) throw new Error(res.message);
      return { rows: res.data, source: res.source };
    },
  });
}
