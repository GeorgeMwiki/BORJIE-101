// TODO(api-gateway): no live `/api/v1/mining/internal/decision-log`
// endpoint exists yet. This fetcher will swallow the 404 and serve
// the bundled mock so the UI keeps rendering; once the gateway adds
// the route the same code path will surface live rows automatically.
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { MOCK_DECISION_LOG } from '@/lib/mocks/decision-log';
import type { DecisionLogRow } from '@/lib/mocks/types';

const KEY = ['internal', 'decision-log'] as const;

interface DecisionLogResult {
  readonly rows: ReadonlyArray<DecisionLogRow>;
  readonly source: 'live' | 'mock';
}

export function useDecisionLogQuery() {
  return useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<DecisionLogResult> => {
      const res = await apiClient.get<ReadonlyArray<DecisionLogRow>>('/decision-log', async () => MOCK_DECISION_LOG);
      if (!res.ok) throw new Error(res.message);
      return { rows: res.data, source: res.source };
    },
  });
}
