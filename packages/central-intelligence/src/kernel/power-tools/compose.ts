/**
 * power_tool.compose — transactional chain of sub-MD calls.
 *
 * The agent defines an ordered list of `power_tool.<id>` or
 * `hq.<tool>` calls and runs them as ONE transactional unit. Every
 * step that succeeds may emit a `compensate` action; if any step fails
 * mid-chain, the registry walks the compensations in reverse and
 * rolls back already-committed effects.
 *
 * Semantics:
 *   - Steps run strictly sequentially (no parallel waves — the chain
 *     is a transaction, not a DAG).
 *   - Each step result must carry `kind: 'ok'` to continue. The first
 *     `refused` or `failed` step halts the chain and triggers rollback.
 *   - Compensations run in reverse order. Each compensation is itself
 *     a power-tool call. A failed compensation is logged but does not
 *     stop the rollback walk.
 *   - The overall outcome is `ok` only when EVERY step succeeded.
 *
 * Tier model:
 *   - requiredTier: estate-manager. The chain runs under the caller's
 *     tier; each step is gated independently by the registry.
 *
 * Approval: none for compose itself. Each child step may carry its
 * own approval requirement and the registry enforces it independently.
 *
 * Audit trail: a `compose-summary` row lands in `audit_events`. Each
 * inner step's audit row is written by the registry directly when it
 * dispatches the step.
 *
 * @module kernel/power-tools/compose
 */

import { z } from 'zod';
import type {
  PowerTool,
  PowerToolContext,
  PowerToolResult,
} from './types.js';
import type { PowerToolRegistry } from './registry.js';

const MAX_STEPS = 20;

// ─────────────────────────────────────────────────────────────────────
// Schema
// ─────────────────────────────────────────────────────────────────────

const ComposeStepSchema = z.object({
  id: z.string().min(1).max(120),
  /** Power-tool id to invoke at this step. */
  toolId: z.string().min(1),
  /** Args passed to the step's power-tool. */
  args: z.record(z.unknown()),
  /**
   * Optional compensating action to invoke if a LATER step fails.
   * Compensations themselves are power-tool calls; their failure
   * during rollback is logged but never escalated.
   */
  compensate: z
    .object({
      toolId: z.string().min(1),
      args: z.record(z.unknown()),
    })
    .optional(),
});

export const ComposeSchema = z.object({
  steps: z.array(ComposeStepSchema).min(1).max(MAX_STEPS),
});

export type ComposeArgs = z.infer<typeof ComposeSchema>;
export type ComposeStep = z.infer<typeof ComposeStepSchema>;

export type ComposeStepStatus = 'ok' | 'failed' | 'rolled-back' | 'skipped';

export interface ComposeStepOutcome {
  readonly id: string;
  readonly toolId: string;
  readonly status: ComposeStepStatus;
  readonly result?: unknown;
  readonly error?: string;
  readonly compensationStatus?: 'ok' | 'failed' | 'skipped';
}

export interface ComposeOutput {
  readonly action: 'compose';
  readonly committed: boolean;
  readonly stepCount: number;
  readonly stepResults: ReadonlyArray<ComposeStepOutcome>;
  readonly rollbackReason: string | null;
}

// ─────────────────────────────────────────────────────────────────────
// Factory — needs a registry reference so it can dispatch child calls.
// ─────────────────────────────────────────────────────────────────────

export function createComposePowerTool(
  registry: PowerToolRegistry,
): PowerTool<ComposeArgs, ComposeOutput> {
  return {
    id: 'compose',
    name: 'Transactional chain',
    description:
      'Run a sequence of power-tool calls as one transactional unit. On mid-chain failure, runs compensations in reverse to roll back.',
    requiredTier: 'estate-manager',
    requiresApproval: false,
    auditDestination: 'audit-events',
    schema: ComposeSchema,
    async execute(
      ctx: PowerToolContext,
      args: ComposeArgs,
    ): Promise<PowerToolResult<ComposeOutput>> {
      // Forbid a compose step from invoking compose recursively.
      for (const step of args.steps) {
        if (step.toolId === 'compose') {
          return {
            kind: 'failed',
            message: `step "${step.id}" cannot recursively invoke compose`,
          };
        }
      }
      // Forbid duplicate step ids.
      const seen = new Set<string>();
      for (const step of args.steps) {
        if (seen.has(step.id)) {
          return {
            kind: 'failed',
            message: `duplicate step id: ${step.id}`,
          };
        }
        seen.add(step.id);
      }

      const outcomes: ComposeStepOutcome[] = [];
      let failedAt: ComposeStepOutcome | null = null;

      for (const step of args.steps) {
        const stepResult = await registry.invoke<unknown>(
          step.toolId,
          step.args,
          ctx,
        );
        if (stepResult.kind === 'ok') {
          outcomes.push({
            id: step.id,
            toolId: step.toolId,
            status: 'ok',
            result: stepResult.output,
          });
          continue;
        }
        // First failure or refusal — record + halt.
        const outcome: ComposeStepOutcome = {
          id: step.id,
          toolId: step.toolId,
          status: 'failed',
          error:
            stepResult.kind === 'refused'
              ? `refused: ${stepResult.reasonCode} - ${stepResult.message}`
              : stepResult.message,
        };
        outcomes.push(outcome);
        failedAt = outcome;
        break;
      }

      if (!failedAt) {
        return {
          kind: 'ok',
          output: {
            action: 'compose',
            committed: true,
            stepCount: args.steps.length,
            stepResults: outcomes,
            rollbackReason: null,
          },
        };
      }

      // Mark every later step as skipped.
      const failedIndex = args.steps.findIndex((s) => s.id === failedAt!.id);
      for (let i = failedIndex + 1; i < args.steps.length; i++) {
        const skipped = args.steps[i];
        outcomes.push({
          id: skipped.id,
          toolId: skipped.toolId,
          status: 'skipped',
          error: 'skipped due to upstream failure',
        });
      }

      // Walk compensations in reverse for the steps that committed
      // BEFORE the failure (the failed step itself never committed).
      for (let i = failedIndex - 1; i >= 0; i--) {
        const original = args.steps[i];
        const outcomeIdx = outcomes.findIndex((o) => o.id === original.id);
        if (outcomeIdx < 0) continue;
        const outcome = outcomes[outcomeIdx];
        if (outcome.status !== 'ok') continue;
        if (!original.compensate) {
          outcomes[outcomeIdx] = {
            ...outcome,
            status: 'rolled-back',
            compensationStatus: 'skipped',
          };
          continue;
        }
        const compResult = await registry.invoke<unknown>(
          original.compensate.toolId,
          original.compensate.args,
          ctx,
        );
        outcomes[outcomeIdx] = {
          ...outcome,
          status: 'rolled-back',
          compensationStatus: compResult.kind === 'ok' ? 'ok' : 'failed',
        };
      }

      return {
        kind: 'refused',
        reasonCode: 'TRANSACTIONAL_ROLLBACK',
        message: `compose chain rolled back at step "${failedAt.id}": ${failedAt.error ?? 'unknown'}`,
      };
    },
  };
}
