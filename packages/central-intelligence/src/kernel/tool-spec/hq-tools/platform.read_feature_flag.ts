/**
 * platform.read_feature_flag — read the current value of a feature flag.
 *
 * Risk tier: read.
 *
 * Counterpart to `platform.set_feature_flag`. Returns the global value
 * plus the per-tenant overrides the caller has scope to see.
 */

import { z } from 'zod';
import {
  type HqToolContext,
  type HqToolExecutionResult,
  type HqToolSpec,
  callerCanReachTenant,
  callerHasAnyScope,
} from '../../risk-tier.js';
import { refusal, withHqTelemetry } from './shared.js';

export const FeatureFlagValueSchema = z.union([z.boolean(), z.string()]);

export const ReadFeatureFlagInputSchema = z.object({
  flagName: z
    .string()
    .min(1)
    .max(120)
    .regex(/^[a-z][a-z0-9_.-]*$/i, 'flagName must be alphanumeric/dot/underscore'),
});

export const ReadFeatureFlagOutputSchema = z.object({
  flagName: z.string(),
  globalValue: FeatureFlagValueSchema.nullable(),
  tenantOverrides: z.array(
    z.object({
      tenantId: z.string(),
      value: FeatureFlagValueSchema,
      updatedAt: z.string(),
    }),
  ),
});

export type ReadFeatureFlagInput = z.infer<typeof ReadFeatureFlagInputSchema>;
export type ReadFeatureFlagOutput = z.infer<typeof ReadFeatureFlagOutputSchema>;

export interface FeatureFlagReadPort {
  read(flagName: string): Promise<ReadFeatureFlagOutput>;
}

export interface ReadFeatureFlagDeps {
  readonly flags: FeatureFlagReadPort;
}

const REQUIRED_SCOPES: ReadonlyArray<string> = [
  'platform:feature-flags:read',
  'platform:ops:read',
];

export function createReadFeatureFlagTool(
  deps: ReadFeatureFlagDeps,
): HqToolSpec<ReadFeatureFlagInput, ReadFeatureFlagOutput> {
  return {
    name: 'platform.read_feature_flag',
    riskTier: 'read',
    description:
      'Read the current global value of a feature flag plus the tenant-scoped overrides the caller has scope to see.',
    inputSchema: ReadFeatureFlagInputSchema,
    outputSchema: ReadFeatureFlagOutputSchema,
    requiredScopes: REQUIRED_SCOPES,
    approvalRequired: false,
    async execute(
      input: ReadFeatureFlagInput,
      ctx: HqToolContext,
    ): Promise<HqToolExecutionResult<ReadFeatureFlagOutput>> {
      return withHqTelemetry({
        toolName: 'platform.read_feature_flag',
        riskTier: 'read',
        approvalRequired: false,
        costEstimateUsd: null,
        tenantId: null,
        ctx,
        input,
        body: async () => {
          if (!callerHasAnyScope(ctx.caller, REQUIRED_SCOPES)) {
            return refusal(
              'OUT_OF_SCOPE',
              'caller lacks platform:feature-flags:read scope',
            );
          }
          const raw = await deps.flags.read(input.flagName);
          const overrides = raw.tenantOverrides.filter((o) =>
            callerCanReachTenant(ctx.caller, o.tenantId),
          );
          return {
            kind: 'ok',
            output: { ...raw, tenantOverrides: overrides },
          };
        },
      });
    },
  };
}
