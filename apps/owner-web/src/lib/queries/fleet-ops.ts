'use client';

import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { apiRequest } from '@/lib/api-client';

/**
 * Fleet-ops query hooks — REAL per-vehicle cost-of-ownership off the live
 * mining BFF, computed server-side by `@borjie/fleet-management`
 * (`computeVehicleTco`) over the tenant's `assets` + `fuel_logs` +
 * `maintenance_events`.
 *
 * Live endpoint: GET /api/v1/mining/fleet-ops/tco
 * (services/api-gateway/src/routes/mining/fleet-ops.hono.ts). Tenant scope
 * is bound server-side via the RLS GUC; the gateway `{ success, data }`
 * envelope is unwrapped by `apiRequest`, so the hook receives `data`.
 *
 * Distinct from `/mining/fleet` (units / match-factor). Money figures are
 * integer minor-units (cents) — the panel renders them with the tenant's
 * reporting currency; no currency is hard-coded here.
 */

// Defence-in-depth: parse the gateway payload so a wire-format drift
// surfaces on react-query's error channel instead of crashing the panel.
const VehicleTcoSchema = z.object({
  vehicleId: z.string(),
  label: z.string(),
  type: z.string(),
  siteId: z.string().nullable().default(null),
  fuelCostCents: z.number(),
  maintenanceCostCents: z.number(),
  depreciationCents: z.number(),
  totalCents: z.number(),
  distanceKm: z.number(),
  costPerKmCents: z.number(),
});

export type VehicleTcoRow = z.infer<typeof VehicleTcoSchema>;

const FleetTotalsSchema = z.object({
  vehicleCount: z.number(),
  fuelCostCents: z.number(),
  maintenanceCostCents: z.number(),
  depreciationCents: z.number(),
  totalCents: z.number(),
});

export type FleetTotals = z.infer<typeof FleetTotalsSchema>;

const FleetOpsTcoSchema = z.object({
  periodStart: z.string(),
  periodEnd: z.string(),
  vehicles: z.array(VehicleTcoSchema),
  fleetTotals: FleetTotalsSchema,
  flags: z.array(z.string()).default([]),
  basis: z.string(),
  provider: z.string().optional(),
});

export type FleetOpsTco = z.infer<typeof FleetOpsTcoSchema>;

export const fleetOpsKeys = {
  tco: (periodStart?: string, periodEnd?: string) =>
    ['fleet-ops', 'tco', periodStart ?? 'default', periodEnd ?? 'default'] as const,
};

export interface UseFleetOpsTcoOptions {
  readonly periodStart?: string;
  readonly periodEnd?: string;
  /** Annualised straight-line depreciation per vehicle, in minor-units. */
  readonly annualDepreciationCents?: number;
}

export function useFleetOpsTco(opts: UseFleetOpsTcoOptions = {}) {
  return useQuery({
    queryKey: fleetOpsKeys.tco(opts.periodStart, opts.periodEnd),
    queryFn: async ({ signal }): Promise<FleetOpsTco> => {
      const qs = new URLSearchParams();
      if (opts.periodStart) qs.set('periodStart', opts.periodStart);
      if (opts.periodEnd) qs.set('periodEnd', opts.periodEnd);
      if (opts.annualDepreciationCents !== undefined) {
        qs.set('annualDepreciationCents', String(opts.annualDepreciationCents));
      }
      const suffix = qs.toString() ? `?${qs.toString()}` : '';
      const raw = await apiRequest<unknown>(
        `/api/v1/mining/fleet-ops/tco${suffix}`,
        { signal },
      );
      return FleetOpsTcoSchema.parse(raw);
    },
    staleTime: 60_000,
  });
}
