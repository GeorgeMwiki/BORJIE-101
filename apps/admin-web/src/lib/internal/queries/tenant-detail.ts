/**
 * react-query bindings for the per-tenant DETAIL rollups behind the console
 * tenant-detail tabs.
 *
 * Live endpoints (services/api-gateway/src/routes/mining/internal/tenants.hono.ts):
 *   GET /:id/operator-summary  → { activeOperators, decisions24h, openTickets }
 *   GET /:id/operators         → operator roster
 *   GET /:id/invoices          → invoice history (PLATFORM_FEE ledger postings)
 *
 * Live-only: failures propagate to react-query's `error` channel; the tabs
 * render DS Skeleton (loading) / DS Empty (zero rows) / Alert (error). No mock
 * fallback — an unbilled tenant has an honestly empty invoice list, not a
 * fabricated one.
 */

import { useQuery } from '@tanstack/react-query';
import { apiClient, unwrap } from '@/lib/api-client';

const TENANT_DETAIL_KEY = ['internal', 'tenant-detail'] as const;

export interface TenantOperatorSummary {
  readonly activeOperators: number;
  readonly decisions24h: number;
  readonly openTickets: number;
}

export interface TenantOperator {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly lastActiveAt: string | null;
}

export interface TenantInvoice {
  readonly id: string;
  readonly issuedAt: string;
  readonly amount: number;
  readonly currency: string;
  // money-core emits EXACTLY 'Posted' — each PLATFORM_FEE ledger leg renders
  // once. The data cannot truthfully distinguish charged/paid/overdue
  // (postedAt is NOT NULL DEFAULT now()), so the old
  // 'Paid' | 'Open' | 'Overdue' union is gone.
  readonly status: 'Posted';
  readonly description?: string;
}

export function useTenantOperatorSummaryQuery(id: string | undefined) {
  return useQuery({
    queryKey: [...TENANT_DETAIL_KEY, id ?? 'none', 'operator-summary'],
    enabled: Boolean(id),
    queryFn: async (): Promise<TenantOperatorSummary> =>
      unwrap(
        await apiClient.get<TenantOperatorSummary>(
          `/tenants/${id ?? ''}/operator-summary`,
        ),
      ),
  });
}

export function useTenantOperatorsQuery(id: string | undefined) {
  return useQuery({
    queryKey: [...TENANT_DETAIL_KEY, id ?? 'none', 'operators'],
    enabled: Boolean(id),
    queryFn: async (): Promise<ReadonlyArray<TenantOperator>> =>
      unwrap(
        await apiClient.get<ReadonlyArray<TenantOperator>>(
          `/tenants/${id ?? ''}/operators`,
        ),
      ),
  });
}

export function useTenantInvoicesQuery(id: string | undefined) {
  return useQuery({
    queryKey: [...TENANT_DETAIL_KEY, id ?? 'none', 'invoices'],
    enabled: Boolean(id),
    queryFn: async (): Promise<ReadonlyArray<TenantInvoice>> =>
      unwrap(
        await apiClient.get<ReadonlyArray<TenantInvoice>>(
          `/tenants/${id ?? ''}/invoices`,
        ),
      ),
  });
}
