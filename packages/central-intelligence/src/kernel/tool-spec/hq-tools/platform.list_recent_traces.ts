/**
 * platform.list_recent_traces — last N kernel decision-traces.
 *
 * Risk tier: read.
 *
 * Wires to the existing `DecisionTraceRecorder` already on the wiring
 * surface. Caller scope: `platform:ops:read` OR
 * `platform:observability:read`.
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

export const ListRecentTracesInputSchema = z.object({
  limit: z.number().int().min(1).max(100).optional(),
  capability: z.string().min(1).max(120).optional(),
  scoreMin: z.number().min(0).max(1).optional(),
  tenantId: z.string().min(1).max(64).optional(),
});

export const RecentTraceRowSchema = z.object({
  traceId: z.string(),
  threadId: z.string(),
  tenantId: z.string().nullable(),
  capability: z.string().nullable(),
  score: z.number().nullable(),
  stepCount: z.number().int().nonnegative(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
});

export const ListRecentTracesOutputSchema = z.object({
  rows: z.array(RecentTraceRowSchema),
  totalReturned: z.number().int().nonnegative(),
});

export type ListRecentTracesInput = z.infer<typeof ListRecentTracesInputSchema>;
export type ListRecentTracesOutput = z.infer<typeof ListRecentTracesOutputSchema>;

export interface DecisionTraceQueryPort {
  listRecent(args: {
    readonly limit: number;
    readonly capability: string | null;
    readonly scoreMin: number | null;
    readonly tenantId: string | null;
  }): Promise<ReadonlyArray<z.infer<typeof RecentTraceRowSchema>>>;
}

export interface ListRecentTracesDeps {
  readonly traces: DecisionTraceQueryPort;
}

const REQUIRED_SCOPES: ReadonlyArray<string> = [
  'platform:ops:read',
  'platform:observability:read',
];

export function createListRecentTracesTool(
  deps: ListRecentTracesDeps,
): HqToolSpec<ListRecentTracesInput, ListRecentTracesOutput> {
  return {
    name: 'platform.list_recent_traces',
    riskTier: 'read',
    description:
      'Last N kernel decision-traces (per-thought breadcrumbs) filtered by capability, score-floor, or tenant. Read-only.',
    inputSchema: ListRecentTracesInputSchema,
    outputSchema: ListRecentTracesOutputSchema,
    requiredScopes: REQUIRED_SCOPES,
    approvalRequired: false,
    async execute(
      input: ListRecentTracesInput,
      ctx: HqToolContext,
    ): Promise<HqToolExecutionResult<ListRecentTracesOutput>> {
      return withHqTelemetry({
        toolName: 'platform.list_recent_traces',
        riskTier: 'read',
        approvalRequired: false,
        costEstimateUsd: null,
        tenantId: input.tenantId ?? null,
        ctx,
        input,
        body: async () => {
          if (!callerHasAnyScope(ctx.caller, REQUIRED_SCOPES)) {
            return refusal(
              'OUT_OF_SCOPE',
              'caller lacks platform:ops:read / observability:read scope',
            );
          }
          if (input.tenantId && !callerCanReachTenant(ctx.caller, input.tenantId)) {
            return refusal(
              'OUT_OF_SCOPE',
              `caller cannot reach tenant ${input.tenantId}`,
            );
          }
          const rows = await deps.traces.listRecent({
            limit: input.limit ?? 25,
            capability: input.capability ?? null,
            scoreMin: input.scoreMin ?? null,
            tenantId: input.tenantId ?? null,
          });
          // Identity-scoped filter: drop any trace whose tenantId the
          // caller cannot reach.
          const filtered = rows.filter((r) =>
            callerCanReachTenant(ctx.caller, r.tenantId),
          );
          return {
            kind: 'ok',
            output: {
              rows: filtered,
              totalReturned: filtered.length,
            },
          };
        },
      });
    },
  };
}
