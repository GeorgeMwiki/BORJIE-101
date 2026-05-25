/**
 * platform.system_health — current health snapshot of every service in
 * the platform: api-gateway, consolidation-worker, wake-loop, verify-
 * cron, primary DB, Redis.
 *
 * Risk tier: read.
 *
 * Always callable by anyone holding `platform:ops:read`. The tool
 * itself never reaches into a tenant's data so the
 * `callerCanReachTenant` check is N/A — we still gate via the RBAC
 * scope set.
 */

import { z } from 'zod';
import {
  type HqToolContext,
  type HqToolExecutionResult,
  type HqToolSpec,
  callerHasAnyScope,
} from '../../risk-tier.js';
import { refusal, withHqTelemetry } from './shared.js';

export const ServiceHealthStateSchema = z.enum([
  'healthy',
  'degraded',
  'unhealthy',
  'unknown',
]);

export const ServiceHealthRowSchema = z.object({
  serviceName: z.string().min(1),
  state: ServiceHealthStateSchema,
  lastHeartbeatAt: z.string().nullable(),
  latencyMsP95: z.number().nonnegative().nullable(),
  notes: z.string().nullable(),
});

export const SystemHealthInputSchema = z.object({
  includeNotes: z.boolean().optional(),
});

export const SystemHealthOutputSchema = z.object({
  overall: ServiceHealthStateSchema,
  services: z.array(ServiceHealthRowSchema),
  capturedAt: z.string(),
});

export type SystemHealthInput = z.infer<typeof SystemHealthInputSchema>;
export type SystemHealthOutput = z.infer<typeof SystemHealthOutputSchema>;

export interface ServiceHeartbeatPort {
  readSnapshot(): Promise<ReadonlyArray<z.infer<typeof ServiceHealthRowSchema>>>;
}

export interface SystemHealthDeps {
  readonly heartbeats: ServiceHeartbeatPort;
}

const REQUIRED_SCOPES: ReadonlyArray<string> = ['platform:ops:read'];

const STATE_RANK: Readonly<Record<z.infer<typeof ServiceHealthStateSchema>, number>> = {
  healthy: 0,
  degraded: 1,
  unhealthy: 2,
  unknown: 3,
};

export function computeOverallState(
  rows: ReadonlyArray<z.infer<typeof ServiceHealthRowSchema>>,
): z.infer<typeof ServiceHealthStateSchema> {
  let worst: z.infer<typeof ServiceHealthStateSchema> = 'healthy';
  for (const row of rows) {
    if (STATE_RANK[row.state] > STATE_RANK[worst]) worst = row.state;
  }
  return worst;
}

export function createSystemHealthTool(deps: SystemHealthDeps): HqToolSpec<
  SystemHealthInput,
  SystemHealthOutput
> {
  return {
    name: 'platform.system_health',
    riskTier: 'read',
    description:
      'Current health of every platform service: api-gateway, consolidation-worker, wake-loop, verify-cron, DB, Redis. Returns per-service state and an overall roll-up.',
    inputSchema: SystemHealthInputSchema,
    outputSchema: SystemHealthOutputSchema,
    requiredScopes: REQUIRED_SCOPES,
    approvalRequired: false,
    async execute(
      input: SystemHealthInput,
      ctx: HqToolContext,
    ): Promise<HqToolExecutionResult<SystemHealthOutput>> {
      return withHqTelemetry({
        toolName: 'platform.system_health',
        riskTier: 'read',
        approvalRequired: false,
        costEstimateUsd: null,
        tenantId: null,
        ctx,
        input,
        body: async () => {
          if (!callerHasAnyScope(ctx.caller, REQUIRED_SCOPES)) {
            return refusal('OUT_OF_SCOPE', 'caller lacks platform:ops:read scope');
          }
          const rows = await deps.heartbeats.readSnapshot();
          const includeNotes = input.includeNotes ?? false;
          const projected = rows.map((r) => ({
            ...r,
            notes: includeNotes ? r.notes : null,
          }));
          return {
            kind: 'ok',
            output: {
              overall: computeOverallState(projected),
              services: projected,
              capturedAt: ctx.clock().toISOString(),
            },
          };
        },
      });
    },
  };
}
