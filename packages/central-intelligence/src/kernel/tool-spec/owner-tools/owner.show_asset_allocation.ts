/**
 * owner.show_asset_allocation — current asset-allocation snapshot for the
 * caller's portfolio, including deployed / available / in-transit asset
 * counts and a renderable kpi-grid + chart-vega UiPart payload.
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

export const ShowAssetAllocationInputSchema = z.object({
  tenantId: z.string().min(1).max(64),
  asOfDate: z.string().min(8).max(32).optional(),
});

export const ShowAssetAllocationOutputSchema = z.object({
  asOfDate: z.string(),
  totalAssets: z.number().int().nonnegative(),
  deployedAssets: z.number().int().nonnegative(),
  availableAssets: z.number().int().nonnegative(),
  inTransitAssets: z.number().int().nonnegative(),
  utilisationRate: z.number().min(0).max(1),
  bySite: z.array(
    z.object({
      siteId: z.string(),
      siteName: z.string(),
      totalAssets: z.number().int().nonnegative(),
      deployedAssets: z.number().int().nonnegative(),
    }),
  ),
});

export type ShowAssetAllocationInput = z.infer<typeof ShowAssetAllocationInputSchema>;
export type ShowAssetAllocationOutput = z.infer<typeof ShowAssetAllocationOutputSchema>;

export interface AssetAllocationServicePort {
  snapshotAssetAllocation(args: {
    readonly tenantId: string;
    readonly asOfDate: string | null;
  }): Promise<ShowAssetAllocationOutput>;
}

export interface ShowAssetAllocationDeps {
  readonly assetAllocation: AssetAllocationServicePort;
}

const REQUIRED_SCOPES: ReadonlyArray<string> = ['owner:asset-allocation:read'];

export function createShowAssetAllocationTool(
  deps: ShowAssetAllocationDeps,
): OwnerToolSpec<ShowAssetAllocationInput, ShowAssetAllocationOutput> {
  return {
    name: 'owner.show_asset_allocation',
    riskTier: 'read',
    description:
      'Asset-allocation snapshot for the caller-owned tenant. Returns total / deployed / available / in-transit counts, utilisation rate, and a per-site breakdown.',
    inputSchema: ShowAssetAllocationInputSchema,
    outputSchema: ShowAssetAllocationOutputSchema,
    requiredScopes: REQUIRED_SCOPES,
    approvalRequired: false,
    async execute(
      input: ShowAssetAllocationInput,
      ctx: HqToolContext,
    ): Promise<HqToolExecutionResult<ShowAssetAllocationOutput>> {
      return withOwnerTelemetry({
        toolName: 'owner.show_asset_allocation',
        riskTier: 'read',
        tenantId: input.tenantId,
        ctx,
        input,
        body: async () => {
          if (!ownerCanReachTenant(ctx.caller.scopes, input.tenantId)) {
            return ownerRefusal(
              'OUT_OF_SCOPE',
              `caller cannot read asset allocation for tenant ${input.tenantId}`,
            );
          }
          const raw = await deps.assetAllocation.snapshotAssetAllocation({
            tenantId: input.tenantId,
            asOfDate: input.asOfDate ?? null,
          });
          // Defensive coherence check — available + deployed + in-transit
          // should sum to total. Trust the service but refuse on a
          // clearly inconsistent payload so we don't render numbers
          // the operator can't reconcile.
          const sum =
            raw.deployedAssets + raw.availableAssets + raw.inTransitAssets;
          if (sum > raw.totalAssets) {
            return ownerRefusal(
              'INVARIANT_VIOLATION',
              `asset-allocation components (${sum}) exceed totalAssets (${raw.totalAssets})`,
            );
          }
          return { kind: 'ok', output: raw };
        },
      });
    },
  };
}
