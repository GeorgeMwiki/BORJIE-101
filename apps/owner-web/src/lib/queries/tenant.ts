'use client';

import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { apiRequest } from '@/lib/api-client';

/**
 * Current-tenant profile + subscription — the owner-accessible read for
 * the Settings plan/billing panel.
 *
 * Live endpoint: GET /api/v1/tenants/current
 * (services/api-gateway/src/routes/tenants.hono.ts). Returns the caller's
 * own tenant (RLS-scoped) with a `subscription` block. NOTE: the cockpit
 * does NOT use `/mining/internal/tenants/*` — that surface is
 * SUPER_ADMIN-only and not callable by an owner.
 *
 * Rows are zod-parsed (defence in depth) so a wire-format drift surfaces
 * on react-query's error channel instead of crashing the panel. Every
 * subscription field is optional → the panel renders honest "—" placeholders
 * rather than fabricated numbers when the gateway omits them.
 */

const TenantSubscriptionSchema = z
  .object({
    plan: z.string().nullable().optional(),
    status: z.string().nullable().optional(),
    maxUnits: z.number().nullable().optional(),
    maxUsers: z.number().nullable().optional(),
  })
  .passthrough();

const TenantCurrentSchema = z
  .object({
    id: z.string(),
    name: z.string().nullable().optional(),
    status: z.string().nullable().optional(),
    contactEmail: z.string().nullable().optional(),
    contactPhone: z.string().nullable().optional(),
    subscription: TenantSubscriptionSchema.optional(),
  })
  .passthrough();

export type TenantCurrent = z.infer<typeof TenantCurrentSchema>;

export const tenantKeys = {
  current: () => ['tenant', 'current'] as const,
};

export function useTenantCurrent() {
  return useQuery({
    queryKey: tenantKeys.current(),
    queryFn: async ({ signal }): Promise<TenantCurrent> => {
      const raw = await apiRequest<unknown>('/api/v1/tenants/current', {
        signal,
      });
      return TenantCurrentSchema.parse(raw);
    },
    staleTime: 60_000,
  });
}
