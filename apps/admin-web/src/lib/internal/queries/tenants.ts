/**
 * react-query bindings for /api/v1/internal/tenants.
 *
 * Every helper returns a query / mutation that the screens can drop
 * straight into a hook. The `fallback` argument keeps the UI alive
 * when the gateway is offline by serving the in-memory fixtures.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient, unwrap, type ApiResult } from '@/lib/api-client';
import { MOCK_TENANTS } from '@/lib/mocks/tenants';
import type { Tenant, TenantStatus } from '@/lib/mocks/types';

const TENANTS_KEY = ['internal', 'tenants'] as const;

interface TenantsResult {
  readonly rows: ReadonlyArray<Tenant>;
  readonly source: 'live' | 'mock';
}

export function useTenantsQuery() {
  return useQuery({
    queryKey: TENANTS_KEY,
    queryFn: async (): Promise<TenantsResult> => {
      const res = await apiClient.get<ReadonlyArray<Tenant>>('/tenants', async () => MOCK_TENANTS);
      if (!res.ok) throw new Error(res.message);
      return { rows: res.data, source: res.source };
    },
  });
}

export function useTenantQuery(id: string | undefined) {
  return useQuery({
    queryKey: [...TENANTS_KEY, id ?? 'none'],
    enabled: Boolean(id),
    queryFn: async () =>
      unwrap(
        await apiClient.get<Tenant>(`/tenants/${id ?? ''}`, async () => {
          const hit = MOCK_TENANTS.find((t) => t.id === id);
          if (!hit) throw new Error('Tenant not found');
          return hit;
        })
      ),
  });
}

interface SetStatusInput {
  readonly id: string;
  readonly status: TenantStatus;
}

export function useSetTenantStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: SetStatusInput): Promise<Tenant> =>
      unwrap(
        await apiClient.patch<Tenant>(`/tenants/${id}/status`, { status }, async () => {
          const hit = MOCK_TENANTS.find((t) => t.id === id);
          if (!hit) throw new Error('Tenant not found');
          return { ...hit, status };
        })
      ),
    /**
     * Optimistic update: flip the row's status the instant the
     * operator clicks. Roll back if the API rejects so the UI never
     * lies about persisted state for longer than one round-trip.
     */
    onMutate: async ({ id, status }) => {
      await qc.cancelQueries({ queryKey: TENANTS_KEY });
      const previous = qc.getQueryData<TenantsResult>(TENANTS_KEY);
      if (previous) {
        qc.setQueryData<TenantsResult>(TENANTS_KEY, {
          ...previous,
          rows: previous.rows.map((t) => (t.id === id ? { ...t, status } : t)),
        });
      }
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(TENANTS_KEY, ctx.previous);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: TENANTS_KEY }),
  });
}

interface ImpersonateResponse {
  readonly bearer: string;
  readonly portalUrl: string;
}

export function useImpersonate() {
  return useMutation({
    mutationFn: async (tenantId: string): Promise<ApiResult<ImpersonateResponse>> =>
      apiClient.post<ImpersonateResponse>(
        `/tenants/${tenantId}/impersonate`,
        {},
        async () => ({
          bearer: `mock_${tenantId}_${Date.now()}`,
          portalUrl: `/portal?impersonate=${tenantId}`,
        })
      ),
  });
}
