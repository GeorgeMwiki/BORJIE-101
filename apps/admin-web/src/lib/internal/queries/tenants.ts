/**
 * react-query bindings for /api/v1/mining/internal/tenants.
 *
 * Live endpoints (services/api-gateway/src/routes/mining/internal/tenants.hono.ts):
 *   GET    /              list (paginated by limit query)
 *   GET    /:id           single tenant
 *   POST   /              provision
 *   PATCH  /:id           plan / billing patch
 *   POST   /:id/suspend   suspend
 *
 * Status-flip (Trial/Past due/etc.) used to map to a PATCH on
 * `/:id/status` that does not exist on the gateway; the only live
 * transition supported is `Suspended` via `POST /:id/suspend`. The
 * legacy `useSetTenantStatus` hook routes that case to the live
 * endpoint and falls back to mock otherwise.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient, unwrap, type ApiResult } from '@/lib/api-client';
import { MOCK_TENANTS } from '@/lib/mocks/tenants';
import type { Tenant, TenantPlan, TenantStatus } from '@/lib/mocks/types';

const TENANTS_KEY = ['internal', 'tenants'] as const;

interface TenantsResult {
  readonly rows: ReadonlyArray<Tenant>;
  readonly source: 'live' | 'mock';
}

interface RawTenant {
  readonly id: string;
  readonly name?: string;
  readonly slug?: string;
  readonly status?: string;
  readonly subscriptionTier?: string;
  readonly plan?: string;
  readonly country?: string;
  readonly region?: string;
  readonly mineral?: string;
  readonly createdAt?: string;
  readonly updatedAt?: string;
  readonly lastActiveAt?: string;
  readonly arrUsd?: number;
}

function planFromTier(raw: string | undefined): TenantPlan {
  if (raw === 'enterprise' || raw === 'custom') return 'Enterprise';
  if (raw === 'professional') return 'Growth';
  return 'Starter';
}

function statusFromRaw(raw: string | undefined): TenantStatus {
  if (raw === 'active') return 'Active';
  if (raw === 'suspended') return 'Suspended';
  if (raw === 'past_due') return 'Past due';
  return 'Trial';
}

function adaptTenant(raw: RawTenant): Tenant {
  return {
    id: raw.id,
    name: raw.name ?? raw.slug ?? raw.id,
    commodity: raw.mineral ?? 'Mixed',
    region: raw.region ?? 'TZ',
    country: raw.country ?? 'TZ',
    plan: planFromTier(raw.subscriptionTier ?? raw.plan),
    status: statusFromRaw(raw.status),
    arrUsd: raw.arrUsd ?? 0,
    lastActiveAt: raw.lastActiveAt ?? raw.updatedAt ?? raw.createdAt ?? new Date().toISOString(),
    createdAt: raw.createdAt ?? new Date().toISOString(),
  };
}

export function useTenantsQuery() {
  return useQuery({
    queryKey: TENANTS_KEY,
    queryFn: async (): Promise<TenantsResult> => {
      const res = await apiClient.get<ReadonlyArray<RawTenant | Tenant>>(
        '/tenants',
        async () => MOCK_TENANTS,
      );
      if (!res.ok) throw new Error(res.message);
      const rows =
        res.source === 'live'
          ? (res.data as ReadonlyArray<RawTenant>).map(adaptTenant)
          : (res.data as ReadonlyArray<Tenant>);
      return { rows, source: res.source };
    },
  });
}

export function useTenantQuery(id: string | undefined) {
  return useQuery({
    queryKey: [...TENANTS_KEY, id ?? 'none'],
    enabled: Boolean(id),
    queryFn: async () => {
      const res = await apiClient.get<RawTenant | Tenant>(`/tenants/${id ?? ''}`, async () => {
        const hit = MOCK_TENANTS.find((t) => t.id === id);
        if (!hit) throw new Error('Tenant not found');
        return hit;
      });
      const data = unwrap(res);
      // Heuristic: live rows lack the front-end `arrUsd` field.
      return 'arrUsd' in (data as object)
        ? (data as Tenant)
        : adaptTenant(data as RawTenant);
    },
  });
}

interface SetStatusInput {
  readonly id: string;
  readonly status: TenantStatus;
}

export function useSetTenantStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: SetStatusInput): Promise<Tenant> => {
      if (status === 'Suspended') {
        const res = await apiClient.post<RawTenant | Tenant>(
          `/tenants/${id}/suspend`,
          {},
          async () => {
            const hit = MOCK_TENANTS.find((t) => t.id === id);
            if (!hit) throw new Error('Tenant not found');
            return { ...hit, status };
          },
        );
        const next = unwrap(res);
        return 'arrUsd' in (next as object)
          ? (next as Tenant)
          : adaptTenant(next as RawTenant);
      }
      // TODO: gateway does not expose non-suspension transitions yet.
      // Mock-only optimistic flip.
      const hit = MOCK_TENANTS.find((t) => t.id === id);
      if (!hit) throw new Error('Tenant not found');
      return { ...hit, status };
    },
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
  // TODO: gateway does not expose impersonation yet; this stays
  // mock-only and is documented for future wiring.
  return useMutation({
    mutationFn: async (tenantId: string): Promise<ApiResult<ImpersonateResponse>> =>
      apiClient.post<ImpersonateResponse>(
        `/tenants/${tenantId}/impersonate`,
        {},
        async () => ({
          bearer: `mock_${tenantId}_${Date.now()}`,
          portalUrl: `/portal?impersonate=${tenantId}`,
        }),
      ),
  });
}
