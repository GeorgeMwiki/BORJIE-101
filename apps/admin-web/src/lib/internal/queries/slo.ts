/**
 * react-query bindings for /api/v1/mining/internal/slo.
 *
 * Live endpoint (services/api-gateway/src/routes/mining/internal/slo.hono.ts):
 *   GET  /                    last-24h SLO snapshot
 *   query: tenantId?, junior?, windowHours?
 *
 * Live-only: failures propagate to react-query's `error` channel.
 */
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type { SloMetric } from '@/lib/internal/types';

const KEY = ['internal', 'slo'] as const;

interface SloResult {
  readonly rows: ReadonlyArray<SloMetric>;
  readonly source: 'live';
}

interface RawSloRow {
  readonly tenantId?: string | null;
  readonly junior?: string;
  readonly juniorId?: string;
  readonly p50ms?: number;
  readonly p95ms?: number;
  readonly p99ms?: number;
  readonly errorRatePct?: number;
  readonly spendUsd?: number;
  readonly requestVolume24h?: number;
  readonly sparkline?: ReadonlyArray<number>;
}

function adaptSlo(raw: RawSloRow): SloMetric {
  return {
    juniorId: raw.juniorId ?? raw.junior ?? 'unknown',
    junior: raw.junior ?? raw.juniorId ?? 'unknown',
    p50ms: raw.p50ms ?? 0,
    p95ms: raw.p95ms ?? 0,
    p99ms: raw.p99ms ?? 0,
    errorRatePct: raw.errorRatePct ?? 0,
    spendUsd: raw.spendUsd ?? 0,
    requestVolume24h: raw.requestVolume24h ?? 0,
    sparkline: raw.sparkline ?? [],
  };
}

export function useSloQuery() {
  return useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<SloResult> => {
      const res = await apiClient.get<ReadonlyArray<RawSloRow>>('/slo');
      if (!res.ok) throw new Error(res.message);
      return { rows: res.data.map(adaptSlo), source: 'live' };
    },
  });
}
