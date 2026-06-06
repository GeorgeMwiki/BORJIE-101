'use client';

import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { apiRequest } from '@/lib/api-client';

/**
 * Procurement-coordination query hooks — REAL vendor registry + budgets +
 * spend analytics off the live mining BFF, served by
 * `@borjie/procurement-coordination` (createProcurementCoordination) over the
 * `procurement_*` tables (migration 0294).
 *
 * Live endpoints
 * (services/api-gateway/src/routes/mining/procurement-coordination.hono.ts):
 *   GET /api/v1/mining/procurement-coordination/vendors
 *   GET /api/v1/mining/procurement-coordination/budgets
 *   GET /api/v1/mining/procurement-coordination/analytics/spend-by-vendor
 *
 * Distinct from `/mining/procurement` (recommendations). Tenant scope is bound
 * server-side via RLS; the gateway `{ success, data }` envelope is unwrapped by
 * `apiRequest`. Defence-in-depth zod parsing. Each amount carries its own
 * ISO-4217 currency — no currency is hard-coded here.
 */

// ── Vendors ──────────────────────────────────────────────────────────────────

const VendorSchema = z.object({
  id: z.string(),
  companyName: z.string(),
  country: z.string(),
  kycStatus: z.string(),
  preferredStatus: z.string(),
  rating: z.number().nullable().default(null),
  categories: z.array(z.string()).default([]),
});

export type ProcurementVendor = z.infer<typeof VendorSchema>;

const VendorsPayloadSchema = z.object({
  vendors: z.array(VendorSchema),
  count: z.number(),
});

// ── Budgets (availability roll-up) ───────────────────────────────────────────

const BudgetAvailabilitySchema = z.object({
  budget: z.object({
    id: z.string(),
    scope: z.string(),
    scopeKey: z.string(),
    period: z.string(),
    amount: z.number(),
    currency: z.string(),
    spent: z.number(),
    committed: z.number(),
    reserved: z.number(),
  }),
  available: z.number(),
  utilisationPct: z.number(),
  alertLevel: z.enum(['green', 'amber', 'red', 'over']),
});

export type BudgetAvailability = z.infer<typeof BudgetAvailabilitySchema>;

const BudgetsPayloadSchema = z.object({
  budgets: z.array(BudgetAvailabilitySchema),
  count: z.number(),
});

// ── Spend by vendor ──────────────────────────────────────────────────────────

const SpendByVendorSchema = z.object({
  vendorId: z.string(),
  vendorName: z.string(),
  amount: z.number(),
  currency: z.string(),
  poCount: z.number(),
  avgPoValue: z.number(),
});

export type SpendByVendor = z.infer<typeof SpendByVendorSchema>;

const SpendByVendorPayloadSchema = z.object({
  vendors: z.array(SpendByVendorSchema),
  count: z.number(),
});

// ── Keys ──────────────────────────────────────────────────────────────────────

export const procurementCoordinationKeys = {
  vendors: () => ['procurement-coordination', 'vendors'] as const,
  budgets: () => ['procurement-coordination', 'budgets'] as const,
  spendByVendor: () => ['procurement-coordination', 'spend-by-vendor'] as const,
};

export function useProcurementVendors() {
  return useQuery({
    queryKey: procurementCoordinationKeys.vendors(),
    queryFn: async ({ signal }) => {
      const raw = await apiRequest<unknown>(
        `/api/v1/mining/procurement-coordination/vendors`,
        { signal },
      );
      return VendorsPayloadSchema.parse(raw);
    },
    staleTime: 60_000,
  });
}

export function useProcurementBudgets() {
  return useQuery({
    queryKey: procurementCoordinationKeys.budgets(),
    queryFn: async ({ signal }) => {
      const raw = await apiRequest<unknown>(
        `/api/v1/mining/procurement-coordination/budgets`,
        { signal },
      );
      return BudgetsPayloadSchema.parse(raw);
    },
    staleTime: 60_000,
  });
}

export function useProcurementSpendByVendor() {
  return useQuery({
    queryKey: procurementCoordinationKeys.spendByVendor(),
    queryFn: async ({ signal }) => {
      const raw = await apiRequest<unknown>(
        `/api/v1/mining/procurement-coordination/analytics/spend-by-vendor`,
        { signal },
      );
      return SpendByVendorPayloadSchema.parse(raw);
    },
    staleTime: 60_000,
  });
}
