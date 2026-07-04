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
import { apiClient, toApiError, unwrap, type ApiResult } from '@/lib/api-client';
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
  /**
   * Canonical mineral slugs the tenant is licensed to handle, from the
   * `tenants.allowed_minerals` JSONB column (the gateway list route
   * `SELECT *`s the row, so this passes through). This is the REAL commodity
   * source — the legacy single `mineral` field was never emitted by the
   * backend, so reading it always yielded the fabricated 'Mixed'.
   */
  readonly allowedMinerals?: ReadonlyArray<string>;
  readonly createdAt?: string;
  readonly updatedAt?: string;
  readonly lastActiveAt?: string;
  /**
   * ARR is NOT a column on `tenants` and is NOT returned by the list route
   * (see `TenantRowSchema`). It stays optional purely so a future enriched
   * payload can supply a real figure; absent that, `adaptTenant` must NOT
   * fabricate one. SaaS revenue truth lives in `tenant_subscriptions`
   * (the `/admin/subscriptions` read-model), not here.
   */
  readonly arr?: number;
  readonly primaryCurrency?: string;
}

/**
 * Build a single honest commodity label from the tenant's licensed minerals.
 * Returns `null` (→ honest dash at the adapter) when the backend supplies no
 * minerals — never the fabricated 'Mixed' the old code always rendered.
 */
function commodityFromMinerals(
  minerals: ReadonlyArray<string> | undefined,
): string | null {
  if (!minerals || minerals.length === 0) return null;
  const cleaned = minerals
    .filter((m): m is string => typeof m === 'string' && m.trim().length > 0)
    .map((m) => m.trim());
  if (cleaned.length === 0) return null;
  // One canonical mineral → render it; several → join the real set (no
  // invented umbrella term).
  return cleaned.join(', ');
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

/** Honest-empty marker for a field the backend did not supply. */
const NO_DATA = '—';

export function adaptTenant(raw: RawTenant): Tenant {
  return {
    id: raw.id,
    name: raw.name ?? raw.slug ?? raw.id,
    // Real commodity from `allowed_minerals`; honest dash when the backend
    // supplies none (never the fabricated 'Mixed' shown as owner truth).
    commodity: commodityFromMinerals(raw.allowedMinerals) ?? NO_DATA,
    region: raw.region ?? 'TZ',
    country: raw.country ?? 'TZ',
    plan: planFromTier(raw.subscriptionTier ?? raw.plan),
    status: statusFromRaw(raw.status),
    // ARR is rendered in the tenant's own `currency`, never assumed USD. The
    // tenants list route does NOT return ARR (no such column / schema field),
    // so `raw.arr` is virtually always absent: we map the real value when a
    // future enriched payload supplies one, and otherwise carry `null` — an
    // HONEST "not available" the consumers render as a localized dash. NEVER a
    // fabricated 0, which would read as `<currency> 0` owner truth.
    arr:
      typeof raw.arr === 'number' && Number.isFinite(raw.arr) ? raw.arr : null,
    currency: raw.primaryCurrency ?? 'TZS',
    lastActiveAt: raw.lastActiveAt ?? raw.updatedAt ?? raw.createdAt ?? new Date().toISOString(),
    createdAt: raw.createdAt ?? new Date().toISOString(),
  };
}

export function useTenantsQuery() {
  return useQuery({
    queryKey: TENANTS_KEY,
    queryFn: async (): Promise<TenantsResult> => {
      const res = await apiClient.get<ReadonlyArray<RawTenant>>('/tenants');
      if (!res.ok) throw toApiError(res);
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

/**
 * Provision (create) a tenant via `POST /api/v1/mining/internal/tenants`
 * (SUPER_ADMIN / ADMIN gated upstream). Mirrors the gateway
 * `ProvisionTenantSchema` shape; only the operator-supplied fields are sent —
 * the gateway defaults country/plan/tier when omitted.
 *
 * On success the tenants list is invalidated so the new row appears without a
 * manual refresh. The mutation surfaces ApiErr through react-query's `error`
 * channel; the form MUST check the result before showing a success affordance
 * (a write that returns an error must never read as "created").
 */
export interface ProvisionTenantInput {
  readonly name: string;
  readonly slug: string;
  readonly primaryEmail: string;
  readonly primaryPhone?: string;
  readonly country?: string;
  readonly plan?: 'mwanzo' | 'mkulima' | 'mfanyabiashara' | 'kampuni' | 'group';
  readonly subscriptionTier?:
    | 'starter'
    | 'professional'
    | 'enterprise'
    | 'custom';
}

export function useProvisionTenant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ProvisionTenantInput): Promise<Tenant> => {
      const res = await apiClient.post<RawTenant>('/tenants', input);
      // unwrap throws on a non-ok envelope — the caller's catch turns it into a
      // visible error, never a silent "created".
      return adaptTenant(unwrap(res));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: TENANTS_KEY }),
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
      // AD-8: activate is the inverse of suspend. The gateway exposes
      // `POST /tenants/:id/activate` (suspended/pending → active),
      // admin-role-guarded + audited.
      if (status === 'Active') {
        const res = await apiClient.post<RawTenant>(`/tenants/${id}/activate`, {});
        return adaptTenant(unwrap(res));
      }
      // Other transitions ('Past due' / 'Trial') are lifecycle states the
      // gateway sets internally (billing webhooks / provisioning), not
      // operator-driven. Surface a real error rather than a silent mock
      // flip.
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
