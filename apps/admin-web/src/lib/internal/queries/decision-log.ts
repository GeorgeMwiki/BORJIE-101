/**
 * react-query bindings for /api/v1/mining/internal/decision-log.
 *
 * Live endpoint (services/api-gateway/src/routes/mining/internal/decision-log.hono.ts):
 *   GET  /                    cursor-paginated decision-trace list
 *   query: tenantId?, junior?, outcome?, cursor?, limit?
 *
 * The live row shape comes from `decision_traces` (id / name / outcome
 * / branches JSONB / chosenBranchId / startedAt). The legacy
 * `DecisionLogRow` shape predates that schema, so the adapter shims
 * the field names. Live-only: failures propagate to the react-query
 * `error` channel.
 */
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type { DecisionLogRow } from '@/lib/internal/types';

const KEY = ['internal', 'decision-log'] as const;

interface DecisionLogResult {
  readonly rows: ReadonlyArray<DecisionLogRow>;
  readonly source: 'live';
}

interface RawTraceRow {
  readonly id?: string;
  readonly at?: string;
  readonly tenantId?: string | null;
  readonly name?: string;
  readonly outcome?: string;
  readonly chosenBranchId?: string | null;
  readonly chosenRationale?: string | null;
  readonly branches?: ReadonlyArray<{ readonly id?: string }>;
  readonly attributes?: Record<string, unknown> | null;
}

function adaptTrace(raw: RawTraceRow): DecisionLogRow {
  const evidenceIds = Array.isArray(raw.branches)
    ? raw.branches.map((b) => b?.id ?? '').filter((s) => s.length > 0)
    : [];
  const conf = raw.attributes?.confidence;
  return {
    id: raw.id ?? `trace_${Math.random().toString(36).slice(2)}`,
    at: raw.at ?? new Date().toISOString(),
    tenantId: raw.tenantId ?? 'platform',
    tenant: raw.tenantId ?? 'platform',
    juniorId: raw.name ?? 'unknown',
    junior: raw.name ?? 'unknown',
    mode: 'Recommend',
    decision: raw.chosenRationale ?? raw.outcome ?? 'unknown',
    evidenceIds,
    confidence: typeof conf === 'number' ? conf : 0,
  };
}

export function useDecisionLogQuery() {
  return useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<DecisionLogResult> => {
      const res = await apiClient.get<ReadonlyArray<RawTraceRow>>('/decision-log');
      if (!res.ok) throw new Error(res.message);
      return { rows: res.data.map(adaptTrace), source: 'live' };
    },
  });
}
