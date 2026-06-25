/**
 * react-query bindings for /api/v1/mining/internal/juniors.
 *
 * Live endpoint (services/api-gateway/src/routes/mining/internal/juniors.hono.ts):
 *   GET / — projects the static JUNIOR_REGISTRY to { name,
 *           schemaFieldCount, acceptsEmptyInput, status: 'ready' }.
 *
 * The route is GET-only — there is NO junior status-transition endpoint
 * on the gateway, so this surface is read-only (the registry is static).
 * Live-only: failures propagate to react-query's `error` channel.
 */

import { useQuery } from '@tanstack/react-query';
import { apiClient, toApiError } from '@/lib/api-client';

const JUNIORS_KEY = ['internal', 'juniors'] as const;

/** Live row shape returned by the gateway. */
export interface JuniorListItem {
  readonly name: string;
  readonly schemaFieldCount: number;
  readonly acceptsEmptyInput: boolean;
  readonly status: 'ready';
}

interface JuniorsResult {
  readonly rows: ReadonlyArray<JuniorListItem>;
  readonly source: 'live';
}

interface RawJunior {
  readonly name?: string;
  readonly schemaFieldCount?: number;
  readonly acceptsEmptyInput?: boolean;
  readonly status?: string;
}

function adaptJunior(raw: RawJunior): JuniorListItem {
  return {
    name: raw.name ?? 'unknown',
    schemaFieldCount:
      typeof raw.schemaFieldCount === 'number' ? raw.schemaFieldCount : 0,
    acceptsEmptyInput: Boolean(raw.acceptsEmptyInput),
    status: 'ready',
  };
}

export function useJuniorsQuery() {
  return useQuery({
    queryKey: JUNIORS_KEY,
    queryFn: async (): Promise<JuniorsResult> => {
      const res = await apiClient.get<ReadonlyArray<RawJunior>>('/juniors');
      if (!res.ok) throw toApiError(res);
      return { rows: res.data.map(adaptJunior), source: 'live' };
    },
  });
}
