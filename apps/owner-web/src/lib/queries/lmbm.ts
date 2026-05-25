'use client';

import { useQuery } from '@tanstack/react-query';
import { apiRequestOrFallback } from '@/lib/api-client';
import { LMBM_MOCK, type LmbmGraph } from '@/lib/mocks/lmbm';

export const lmbmKeys = {
  graph: (asOf: string) => ['lmbm', 'graph', asOf] as const,
};

export function useLmbmGraph(asOf: string) {
  return useQuery({
    queryKey: lmbmKeys.graph(asOf),
    queryFn: ({ signal }) =>
      apiRequestOrFallback<LmbmGraph>(
        `/api/v1/owner/lmbm/graph?asOf=${encodeURIComponent(asOf)}`,
        LMBM_MOCK,
        { signal },
      ),
  });
}
