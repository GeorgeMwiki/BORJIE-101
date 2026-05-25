/**
 * platform.run_consolidation_tick — manually run one tick of the
 * `services/consolidation-worker` (the 8-stage nightly sleep-time
 * consolidator) instead of waiting for the cron schedule.
 *
 * Risk tier: mutate.
 *
 * Rollback: the consolidation worker produces deltas in the memory
 * hierarchy. The composition root supplies a snapshot-based
 * `rollbackToSnapshot` that reverts the post-tick semantic facts and
 * reflective digests to the pre-tick checkpoint.
 *
 * `dryRun: true` short-circuits writes and returns the same report
 * shape with `applied: false` — useful for "would running consolidation
 * now be safe?" prompts.
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

export const RunConsolidationTickInputSchema = z.object({
  tenantId: z.string().min(1).max(64).optional(),
  dryRun: z.boolean().optional(),
});

export const ConsolidationTickReportSchema = z.object({
  tickId: z.string(),
  tenantId: z.string().nullable(),
  applied: z.boolean(),
  startedAt: z.string(),
  finishedAt: z.string(),
  factsExtracted: z.number().int().nonnegative(),
  patternsDetected: z.number().int().nonnegative(),
  digestsWritten: z.number().int().nonnegative(),
  decayedEntries: z.number().int().nonnegative(),
  snapshotId: z.string().nullable(),
});

export type RunConsolidationTickInput = z.infer<
  typeof RunConsolidationTickInputSchema
>;
export type RunConsolidationTickOutput = z.infer<
  typeof ConsolidationTickReportSchema
>;

export interface ConsolidationRunnerPort {
  runTick(args: {
    readonly tenantId: string | null;
    readonly dryRun: boolean;
  }): Promise<RunConsolidationTickOutput>;
  rollbackToSnapshot(snapshotId: string): Promise<void>;
}

export interface RunConsolidationTickDeps {
  readonly consolidation: ConsolidationRunnerPort;
}

const REQUIRED_SCOPES: ReadonlyArray<string> = ['platform:consolidation:run'];

export function createRunConsolidationTickTool(
  deps: RunConsolidationTickDeps,
): HqToolSpec<RunConsolidationTickInput, RunConsolidationTickOutput> {
  return {
    name: 'platform.run_consolidation_tick',
    riskTier: 'mutate',
    description:
      'Manually run one tick of the consolidation worker (8-stage sleep-time consolidator). Optional dryRun returns the report without writing.',
    inputSchema: RunConsolidationTickInputSchema,
    outputSchema: ConsolidationTickReportSchema,
    requiredScopes: REQUIRED_SCOPES,
    approvalRequired: false,
    rollback: async (output, _ctx) => {
      if (!output.applied || !output.snapshotId) return;
      await deps.consolidation.rollbackToSnapshot(output.snapshotId);
    },
    async execute(
      input: RunConsolidationTickInput,
      ctx: HqToolContext,
    ): Promise<HqToolExecutionResult<RunConsolidationTickOutput>> {
      return withHqTelemetry({
        toolName: 'platform.run_consolidation_tick',
        riskTier: 'mutate',
        approvalRequired: false,
        costEstimateUsd: null,
        tenantId: input.tenantId ?? null,
        ctx,
        input,
        body: async () => {
          if (!callerHasAnyScope(ctx.caller, REQUIRED_SCOPES)) {
            return refusal(
              'OUT_OF_SCOPE',
              'caller lacks platform:consolidation:run scope',
            );
          }
          if (input.tenantId && !callerCanReachTenant(ctx.caller, input.tenantId)) {
            return refusal(
              'OUT_OF_SCOPE',
              `caller cannot reach tenant ${input.tenantId}`,
            );
          }
          const report = await deps.consolidation.runTick({
            tenantId: input.tenantId ?? null,
            dryRun: input.dryRun ?? false,
          });
          return { kind: 'ok', output: report };
        },
      });
    },
  };
}
