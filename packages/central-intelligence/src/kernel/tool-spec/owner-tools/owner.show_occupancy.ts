/**
 * owner.show_occupancy — current occupancy snapshot for the caller's
 * portfolio, including occupied / vacant / notice-period unit counts
 * and a renderable kpi-grid + chart-vega UiPart payload.
 *
 * Risk tier: read.
 */

import { z } from 'zod';
import type {
  HqToolContext,
  HqToolExecutionResult,
} from '../../risk-tier.js';
import { ownerCanReachTenant, ownerRefusal, withOwnerTelemetry } from './shared.js';
import type { OwnerToolSpec } from './types.js';

export const ShowOccupancyInputSchema = z.object({
  tenantId: z.string().min(1).max(64),
  asOfDate: z.string().min(8).max(32).optional(),
});

export const ShowOccupancyOutputSchema = z.object({
  asOfDate: z.string(),
  totalUnits: z.number().int().nonnegative(),
  occupiedUnits: z.number().int().nonnegative(),
  vacantUnits: z.number().int().nonnegative(),
  noticePeriodUnits: z.number().int().nonnegative(),
  occupancyRate: z.number().min(0).max(1),
  byProperty: z.array(
    z.object({
      propertyId: z.string(),
      propertyName: z.string(),
      totalUnits: z.number().int().nonnegative(),
      occupiedUnits: z.number().int().nonnegative(),
    }),
  ),
});

export type ShowOccupancyInput = z.infer<typeof ShowOccupancyInputSchema>;
export type ShowOccupancyOutput = z.infer<typeof ShowOccupancyOutputSchema>;

export interface OccupancyServicePort {
  snapshotOccupancy(args: {
    readonly tenantId: string;
    readonly asOfDate: string | null;
  }): Promise<ShowOccupancyOutput>;
}

export interface ShowOccupancyDeps {
  readonly occupancy: OccupancyServicePort;
}

const REQUIRED_SCOPES: ReadonlyArray<string> = ['owner:occupancy:read'];

export function createShowOccupancyTool(
  deps: ShowOccupancyDeps,
): OwnerToolSpec<ShowOccupancyInput, ShowOccupancyOutput> {
  return {
    name: 'owner.show_occupancy',
    riskTier: 'read',
    description:
      'Occupancy snapshot for the caller-owned tenant. Returns total / occupied / vacant / notice-period counts, occupancy rate, and a per-property breakdown.',
    inputSchema: ShowOccupancyInputSchema,
    outputSchema: ShowOccupancyOutputSchema,
    requiredScopes: REQUIRED_SCOPES,
    approvalRequired: false,
    async execute(
      input: ShowOccupancyInput,
      ctx: HqToolContext,
    ): Promise<HqToolExecutionResult<ShowOccupancyOutput>> {
      return withOwnerTelemetry({
        toolName: 'owner.show_occupancy',
        riskTier: 'read',
        tenantId: input.tenantId,
        ctx,
        input,
        body: async () => {
          if (!ownerCanReachTenant(ctx.caller.scopes, input.tenantId)) {
            return ownerRefusal(
              'OUT_OF_SCOPE',
              `caller cannot read occupancy for tenant ${input.tenantId}`,
            );
          }
          const raw = await deps.occupancy.snapshotOccupancy({
            tenantId: input.tenantId,
            asOfDate: input.asOfDate ?? null,
          });
          // Defensive coherence check — vacant + occupied + notice
          // should sum to total. Trust the service but refuse on a
          // clearly inconsistent payload so we don't render numbers
          // the operator can't reconcile.
          const sum =
            raw.occupiedUnits + raw.vacantUnits + raw.noticePeriodUnits;
          if (sum > raw.totalUnits) {
            return ownerRefusal(
              'INVARIANT_VIOLATION',
              `occupancy components (${sum}) exceed totalUnits (${raw.totalUnits})`,
            );
          }
          return { kind: 'ok', output: raw };
        },
      });
    },
  };
}
