/**
 * platform.set_killswitch — set the platform-wide or per-tenant
 * killswitch state.
 *
 * Risk tier: destroy. Requires four-eye approval.
 *
 * Reversible: the rollback restores the previous level + reason. This
 * is the "off-switch for the brain" — when an operator flips it to
 * HALT the kernel short-circuits before any sensor work, so we treat
 * any flip as a sovereign-ledger event.
 *
 * Per the existing `KillswitchPort` in `kernel/killswitch.ts`, the
 * default port reads from env vars. This tool's `writePort` therefore
 * accepts both env-backed and flag-service-backed writes; the
 * composition root chooses which.
 */

import { z } from 'zod';
import {
  type HqToolContext,
  type HqToolExecutionResult,
  type HqToolSpec,
  callerCanReachTenant,
  callerHasAllScopes,
} from '../../risk-tier.js';
import type {
  KillswitchLevel,
  KillswitchReasonCode,
  KillswitchState,
} from '../../killswitch.js';
import { refusal, withHqTelemetry } from './shared.js';

const KillswitchScopeSchema = z.union([
  z.literal('platform'),
  z.string().regex(/^tenant:[A-Za-z0-9_-]{1,64}$/),
]);

export const KillswitchLevelSchema = z.enum(['live', 'degraded', 'halt']);

export const KillswitchReasonCodeSchema = z.enum([
  'KILLSWITCH_HALT',
  'COMPLIANCE_HOLD_CBK',
  'COMPLIANCE_HOLD_EAC',
  'COMPLIANCE_HOLD_OAG',
  'PROVIDER_INCIDENT',
  'STALE_GROUNDING_FACTS',
  'TENANT_HALT',
  'TENANT_DATA_LEAK_SUSPECTED',
  'TENANT_PORTAL_COMPROMISED',
  'OWNER_STATEMENT_DISPUTE',
  'MAINTENANCE_TICKET_STORM',
]);

export const SetKillswitchInputSchema = z.object({
  scope: KillswitchScopeSchema,
  level: KillswitchLevelSchema,
  reasonCode: KillswitchReasonCodeSchema,
  note: z.string().min(1).max(500).optional(),
});

export const SetKillswitchOutputSchema = z.object({
  scope: KillswitchScopeSchema,
  level: KillswitchLevelSchema,
  reasonCode: KillswitchReasonCodeSchema,
  note: z.string().nullable(),
  previous: z
    .object({
      level: KillswitchLevelSchema,
      reasonCode: KillswitchReasonCodeSchema,
      note: z.string().nullable(),
    })
    .nullable(),
  updatedAt: z.string(),
});

export type SetKillswitchInput = z.infer<typeof SetKillswitchInputSchema>;
export type SetKillswitchOutput = z.infer<typeof SetKillswitchOutputSchema>;

export interface KillswitchWritePort {
  writeKillswitch(args: {
    readonly scope: 'platform' | `tenant:${string}`;
    readonly level: KillswitchLevel;
    readonly reasonCode: KillswitchReasonCode;
    readonly note: string | null;
  }): Promise<SetKillswitchOutput>;
  restoreKillswitch(args: {
    readonly scope: 'platform' | `tenant:${string}`;
    readonly previous: KillswitchState | null;
  }): Promise<void>;
}

export interface SetKillswitchDeps {
  readonly killswitch: KillswitchWritePort;
}

const REQUIRED_SCOPES: ReadonlyArray<string> = [
  'platform:killswitch:write',
  'platform:ops:write',
];

function parseTenantFromScope(scope: string): string | null {
  if (scope === 'platform') return null;
  return scope.slice('tenant:'.length);
}

export function createSetKillswitchTool(
  deps: SetKillswitchDeps,
): HqToolSpec<SetKillswitchInput, SetKillswitchOutput> {
  return {
    name: 'platform.set_killswitch',
    riskTier: 'destroy',
    description:
      'Set platform or per-tenant killswitch level (live | degraded | halt). Four-eye approval required. Reversible via rollback (restores previous level).',
    inputSchema: SetKillswitchInputSchema,
    outputSchema: SetKillswitchOutputSchema,
    requiredScopes: REQUIRED_SCOPES,
    approvalRequired: true,
    rollback: async (output, _ctx) => {
      await deps.killswitch.restoreKillswitch({
        scope: output.scope as 'platform' | `tenant:${string}`,
        previous: output.previous
          ? {
              level: output.previous.level,
              reasonCode: output.previous.reasonCode,
              ...(output.previous.note !== null ? { note: output.previous.note } : {}),
            }
          : null,
      });
    },
    async execute(
      input: SetKillswitchInput,
      ctx: HqToolContext,
    ): Promise<HqToolExecutionResult<SetKillswitchOutput>> {
      const tenantId = parseTenantFromScope(input.scope);
      return withHqTelemetry({
        toolName: 'platform.set_killswitch',
        riskTier: 'destroy',
        approvalRequired: true,
        costEstimateUsd: null,
        tenantId,
        ctx,
        input,
        body: async () => {
          // Destroy-tier tools demand the FULL scope set, not any.
          if (!callerHasAllScopes(ctx.caller, REQUIRED_SCOPES)) {
            return refusal(
              'OUT_OF_SCOPE',
              'caller lacks platform:killswitch:write + platform:ops:write scopes',
            );
          }
          if (tenantId !== null && !callerCanReachTenant(ctx.caller, tenantId)) {
            return refusal(
              'OUT_OF_SCOPE',
              `caller cannot reach tenant ${tenantId}`,
            );
          }
          const out = await deps.killswitch.writeKillswitch({
            scope: input.scope as 'platform' | `tenant:${string}`,
            level: input.level,
            reasonCode: input.reasonCode,
            note: input.note ?? null,
          });
          return { kind: 'ok', output: out };
        },
      });
    },
  };
}
