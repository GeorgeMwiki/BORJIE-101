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
 * Live-only: failures propagate to react-query's `error` channel. The
 * `useImpersonate` hook calls the gateway impersonation endpoint
 * directly; that endpoint is not yet wired upstream and will return
 * 404 until it lands.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient, unwrap, type ApiResult } from '@/lib/api-client';
import type { Tenant, TenantPlan, TenantStatus } from '@/lib/internal/types';

const TENANTS_KEY = ['internal', 'tenants'] as const;

interface TenantsResult {
  readonly rows: ReadonlyArray<Tenant>;
  readonly source: 'live';
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
      const res = await apiClient.get<ReadonlyArray<RawTenant>>('/tenants');
      if (!res.ok) throw new Error(res.message);
      return { rows: res.data.map(adaptTenant), source: 'live' };
    },
  });
}

export function useTenantQuery(id: string | undefined) {
  return useQuery({
    queryKey: [...TENANTS_KEY, id ?? 'none'],
    enabled: Boolean(id),
    queryFn: async () => {
      const res = await apiClient.get<RawTenant>(`/tenants/${id ?? ''}`);
      const data = unwrap(res);
      return adaptTenant(data);
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
        const res = await apiClient.post<RawTenant>(`/tenants/${id}/suspend`, {});
        return adaptTenant(unwrap(res));
      }
      // See gh-issue #25: non-suspension status transitions are not
      // yet exposed by the gateway. Until they are, this surface
      // throws so the UI can render a real error instead of a silent
      // mock flip.
      throw new Error(
        `Tenant status transition '${status}' is not supported by the live gateway`,
      );
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
  // See gh-issue #25: gateway does not yet expose impersonation; the
  // call will 404 until that route lands. Surfaced as an ApiErr so the
  // UI can render an explicit "not yet wired" toast.
  return useMutation({
    mutationFn: async (tenantId: string): Promise<ApiResult<ImpersonateResponse>> =>
      apiClient.post<ImpersonateResponse>(`/tenants/${tenantId}/impersonate`, {}),
  });
}
