'use client';

import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { apiRequest } from '@/lib/api-client';

/**
 * Inventory query hooks — REAL consumables / spares inventory off the live
 * mining BFF, computed server-side by `@borjie/inventory-management` over the
 * `inventory_skus` + `inventory_stock_movements` tables (migration 0292).
 *
 * Live endpoints (services/api-gateway/src/routes/mining/inventory.hono.ts):
 *   GET /api/v1/mining/inventory/skus
 *   GET /api/v1/mining/inventory/reorder
 *   GET /api/v1/mining/inventory/analytics/on-hand-value
 *
 * Tenant scope is bound server-side via the RLS GUC; the gateway
 * `{ success, data }` envelope is unwrapped by `apiRequest`. Defence-in-depth
 * zod parsing surfaces wire drift on the error channel. Money figures are
 * integer minor-units — no currency is hard-coded here.
 */

// ── SKU catalog ───────────────────────────────────────────────────────────

const SkuSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  unit: z.string(),
  defaultUnitCostCents: z.number(),
  minimumStockLevel: z.number(),
  reorderQty: z.number(),
  leadTimeDays: z.number(),
  isAsset: z.boolean(),
});

export type InventorySku = z.infer<typeof SkuSchema>;

const SkusPayloadSchema = z.object({
  skus: z.array(SkuSchema),
  count: z.number(),
});

// ── Reorder candidates ─────────────────────────────────────────────────────

const ReorderCandidateSchema = z.object({
  skuId: z.string(),
  locationId: z.string(),
  onHand: z.number(),
  minimumStockLevel: z.number(),
  shortfall: z.number(),
  suggestedQty: z.number(),
  leadTimeDays: z.number(),
  defaultUnitCostCents: z.number(),
  abcBand: z.enum(['A', 'B', 'C']),
});

export type ReorderCandidate = z.infer<typeof ReorderCandidateSchema>;

const ReorderPayloadSchema = z.object({
  candidates: z.array(ReorderCandidateSchema),
  purchaseOrderSpecs: z
    .array(
      z.object({
        vendorId: z.string(),
        subtotalCents: z.number(),
        lines: z.array(z.unknown()),
      }),
    )
    .default([]),
  count: z.number(),
});

// ── On-hand value ──────────────────────────────────────────────────────────

const OnHandValueSchema = z.object({
  locationId: z.string().nullable().default(null),
  byCategoryValueCents: z.record(z.string(), z.number()).default({}),
  totalValueCents: z.number(),
  snapshotAt: z.string(),
});

export type OnHandValueSnapshot = z.infer<typeof OnHandValueSchema>;

// ── Keys ────────────────────────────────────────────────────────────────────

export const inventoryKeys = {
  skus: () => ['inventory', 'skus'] as const,
  reorder: (locationId?: string) =>
    ['inventory', 'reorder', locationId ?? 'all'] as const,
  onHandValue: (locationId?: string) =>
    ['inventory', 'on-hand-value', locationId ?? 'all'] as const,
};

export function useInventorySkus() {
  return useQuery({
    queryKey: inventoryKeys.skus(),
    queryFn: async ({ signal }) => {
      const raw = await apiRequest<unknown>(
        `/api/v1/mining/inventory/skus`,
        { signal },
      );
      return SkusPayloadSchema.parse(raw);
    },
    staleTime: 60_000,
  });
}

export function useInventoryReorder(locationId?: string) {
  return useQuery({
    queryKey: inventoryKeys.reorder(locationId),
    queryFn: async ({ signal }) => {
      const qs = locationId
        ? `?locationId=${encodeURIComponent(locationId)}`
        : '';
      const raw = await apiRequest<unknown>(
        `/api/v1/mining/inventory/reorder${qs}`,
        { signal },
      );
      return ReorderPayloadSchema.parse(raw);
    },
    staleTime: 60_000,
  });
}

export function useInventoryOnHandValue(locationId?: string) {
  return useQuery({
    queryKey: inventoryKeys.onHandValue(locationId),
    queryFn: async ({ signal }) => {
      const qs = locationId
        ? `?locationId=${encodeURIComponent(locationId)}`
        : '';
      const raw = await apiRequest<unknown>(
        `/api/v1/mining/inventory/analytics/on-hand-value${qs}`,
        { signal },
      );
      return OnHandValueSchema.parse(raw);
    },
    staleTime: 60_000,
  });
}
