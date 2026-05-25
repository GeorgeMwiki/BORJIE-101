/**
 * platform.set_feature_flag — flip a feature flag, globally or on a
 * specific tenant.
 *
 * Risk tier: mutate.
 *
 * Rollback: restore the previous value (or remove the override) — the
 * port captures the previous-value snapshot so we can replay the
 * compensation deterministically.
 *
 * Scope syntax:
 *   - 'global'           → modifies the platform-wide default
 *   - 'tenant:<id>'      → modifies the per-tenant override
 */

import { z } from 'zod';
import {
  type HqToolContext,
  type HqToolExecutionResult,
  type HqToolSpec,
  callerCanReachTenant,
  callerHasAnyScope,
} from '../../risk-tier.js';
import { FeatureFlagValueSchema } from './platform.read_feature_flag.js';
import { refusal, withHqTelemetry } from './shared.js';

const FlagScopeSchema = z.union([
  z.literal('global'),
  z.string().regex(/^tenant:[A-Za-z0-9_-]{1,64}$/),
]);

export const SetFeatureFlagInputSchema = z.object({
  flagName: z
    .string()
    .min(1)
    .max(120)
    .regex(/^[a-z][a-z0-9_.-]*$/i),
  value: FeatureFlagValueSchema,
  scope: FlagScopeSchema,
});

export const SetFeatureFlagOutputSchema = z.object({
  flagName: z.string(),
  scope: FlagScopeSchema,
  previousValue: FeatureFlagValueSchema.nullable(),
  value: FeatureFlagValueSchema,
  updatedAt: z.string(),
});

export type SetFeatureFlagInput = z.infer<typeof SetFeatureFlagInputSchema>;
export type SetFeatureFlagOutput = z.infer<typeof SetFeatureFlagOutputSchema>;

export interface FeatureFlagWritePort {
  setFlag(args: {
    readonly flagName: string;
    readonly value: boolean | string;
    readonly scope: 'global' | `tenant:${string}`;
  }): Promise<SetFeatureFlagOutput>;
  restoreFlag(args: {
    readonly flagName: string;
    readonly scope: 'global' | `tenant:${string}`;
    readonly previousValue: boolean | string | null;
  }): Promise<void>;
}

export interface SetFeatureFlagDeps {
  readonly flags: FeatureFlagWritePort;
}

const REQUIRED_SCOPES: ReadonlyArray<string> = ['platform:feature-flags:write'];

function parseTenantFromScope(scope: string): string | null {
  if (scope === 'global') return null;
  return scope.slice('tenant:'.length);
}

export function createSetFeatureFlagTool(
  deps: SetFeatureFlagDeps,
): HqToolSpec<SetFeatureFlagInput, SetFeatureFlagOutput> {
  return {
    name: 'platform.set_feature_flag',
    riskTier: 'mutate',
    description:
      'Flip a feature flag. Scope may be "global" or "tenant:<id>". Reversible via rollback (restores previous value).',
    inputSchema: SetFeatureFlagInputSchema,
    outputSchema: SetFeatureFlagOutputSchema,
    requiredScopes: REQUIRED_SCOPES,
    approvalRequired: false,
    rollback: async (output, _ctx) => {
      await deps.flags.restoreFlag({
        flagName: output.flagName,
        scope: output.scope as 'global' | `tenant:${string}`,
        previousValue: output.previousValue,
      });
    },
    async execute(
      input: SetFeatureFlagInput,
      ctx: HqToolContext,
    ): Promise<HqToolExecutionResult<SetFeatureFlagOutput>> {
      const tenantId = parseTenantFromScope(input.scope);
      return withHqTelemetry({
        toolName: 'platform.set_feature_flag',
        riskTier: 'mutate',
        approvalRequired: false,
        costEstimateUsd: null,
        tenantId,
        ctx,
        input,
        body: async () => {
          if (!callerHasAnyScope(ctx.caller, REQUIRED_SCOPES)) {
            return refusal(
              'OUT_OF_SCOPE',
              'caller lacks platform:feature-flags:write scope',
            );
          }
          if (tenantId !== null && !callerCanReachTenant(ctx.caller, tenantId)) {
            return refusal(
              'OUT_OF_SCOPE',
              `caller cannot reach tenant ${tenantId}`,
            );
          }
          const out = await deps.flags.setFlag({
            flagName: input.flagName,
            value: input.value,
            scope: input.scope as 'global' | `tenant:${string}`,
          });
          return { kind: 'ok', output: out };
        },
      });
    },
  };
}
