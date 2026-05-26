'use client';

import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api-client';
import type { LmbmGraph } from '@/lib/types/lmbm';

export const lmbmKeys = {
  graph: (asOf: string) => ['lmbm', 'graph', asOf] as const,
};

export function useLmbmGraph(asOf: string) {
  return useQuery({
    queryKey: lmbmKeys.graph(asOf),
    queryFn: ({ signal }) =>
      // Live endpoint: GET /api/v1/mining/lmbm/graph
      // (services/api-gateway/src/routes/mining/lmbm.hono.ts).
      apiRequest<LmbmGraph>(
        `/api/v1/mining/lmbm/graph?asOf=${encodeURIComponent(asOf)}`,
        { signal },
      ),
  });
}
