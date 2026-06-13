/**
 * react-query bindings for /api/v1/mining/internal/models — the HQ AI-model
 * spend overview (AD-3).
 *
 * Live endpoint (services/api-gateway/src/routes/mining/internal/models.hono.ts)
 * aggregates the REAL `ai_cost_entries` ledger into a per-model rollup:
 *   GET / → [{ provider, model, calls, inputTokens, outputTokens, costUsd, lastUsedAt }]
 *
 * It deliberately omits per-junior assignment + p50 latency (not real columns
 * today) — so this surface reports only honest, ledger-backed numbers. A fresh
 * platform with no LLM calls yet returns [], which the UI renders as an honest
 * empty state (never fabricated spend).
 */
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

const KEY = ['internal', 'models-overview'] as const;

export interface ModelRollupRow {
  readonly provider: string;
  readonly model: string;
  readonly calls: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costUsd: number;
  readonly lastUsedAt: string | null;
}

interface OverviewResult {
  readonly rows: ReadonlyArray<ModelRollupRow>;
  readonly source: 'live';
}

export function useModelsOverviewQuery() {
  return useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<OverviewResult> => {
      const res = await apiClient.get<ReadonlyArray<ModelRollupRow>>('/models');
      if (!res.ok) throw new Error(res.message);
      return { rows: res.data ?? [], source: 'live' };
    },
  });
}
