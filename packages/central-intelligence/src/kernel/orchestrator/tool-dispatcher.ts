/**
 * Tool dispatcher adapter (Item-5).
 *
 * Implements the orchestrator's `Dispatcher` port over the kernel's real
 * `BrainToolRegistry`. The main loop hands it a `Decision` (already gated
 * by the 9-hook PreToolUse chain) and expects a closed `DispatchResult`.
 *
 * Mapping (Decision → DispatchResult):
 *   - `tool_call`        → run the registry tool via `runTool(...)`; a
 *                          `BrainToolOutcome` is mapped onto `tool_ok` /
 *                          `tool_error`.
 *   - `respond_to_owner` → `response` (the model's final text).
 *   - `final`            → `response` (graceful close).
 *   - `schedule_wake`    → `wake_ack`.
 *   - `monitor`          → `monitor_ack`.
 *   - `spawn_sub_md`     → `spawn_ack`. Inline sub-MD execution is a
 *                          separate subsystem; the dispatcher acks the
 *                          spawn (preserving the parent's fire-and-forget
 *                          contract) and an optional injected
 *                          `spawnHandler` can perform the real fork.
 *
 * Pure-async; never throws out of `dispatch` — a registry/executor
 * failure surfaces as a `tool_error` so the main loop can re-plan rather
 * than crash the turn.
 *
 * @module kernel/orchestrator/tool-dispatcher
 */

import type { BrainToolRegistry } from '../tool-spec.js';
import type { Decision, DispatchResult, SubMdSpawn } from './decision.js';
import type { Dispatcher } from './main-loop.js';
import type { HookContext } from './hook-chain.js';

export interface ToolDispatcherConfig {
  /** The kernel's tool registry — the SAME catalog projected into toolSearch. */
  readonly registry: BrainToolRegistry;
  /** Monotonic clock for latency measurement. Defaults to `Date.now`. */
  readonly clock?: () => number;
  /**
   * Optional handoff token generator for spawn acks. Defaults to a
   * monotonic per-dispatcher counter. Production may inject
   * `() => randomUUID()`.
   */
  readonly handoffTokenGenerator?: () => string;
  /**
   * Optional real sub-MD spawn handler. When wired, a `spawn_sub_md`
   * decision invokes it; when omitted, the dispatcher returns a
   * structured `spawn_ack` breadcrumb (the Phase-E placeholder behaviour)
   * so the parent loop's fire-and-forget contract still holds.
   */
  readonly spawnHandler?: (
    spawn: SubMdSpawn,
  ) => Promise<{ readonly handoffToken: string }>;
  /** Optional logger (Pino-style). No console.* per the hard rules. */
  readonly logger?: {
    warn(msg: string, meta?: Record<string, unknown>): void;
  };
}

/**
 * Build a real `Dispatcher` that actuates each `Decision` variant.
 */
export function createToolDispatcher(config: ToolDispatcherConfig): Dispatcher {
  const clock = config.clock ?? Date.now;
  let handoffSeq = 0;
  const nextHandoff =
    config.handoffTokenGenerator ??
    ((): string => {
      handoffSeq += 1;
      return `handoff_${handoffSeq}`;
    });

  async function dispatchToolCall(
    decision: Extract<Decision, { kind: 'tool_call' }>,
  ): Promise<DispatchResult> {
    const started = clock();
    const { toolName, input, callId } = decision.call;
    try {
      const outcome = await config.registry.runTool(toolName, input);
      const latencyMs = clock() - started;
      switch (outcome.kind) {
        case 'ok':
          return {
            kind: 'tool_ok',
            callId,
            output: outcome.output,
            latencyMs,
            // The deterministic BrainTool layer is not token-metered;
            // token/cost accounting rides the sensor/router seam. Report
            // zeros so the budget's tool-call axis still advances.
            tokensIn: 0,
            tokensOut: 0,
            usdCost: 0,
          };
        case 'not-found':
          return {
            kind: 'tool_error',
            callId,
            message: `tool not found: ${toolName}`,
            latencyMs,
          };
        case 'input-invalid':
          return {
            kind: 'tool_error',
            callId,
            message: `input-invalid: ${outcome.issue}`,
            latencyMs,
          };
        case 'output-invalid':
          return {
            kind: 'tool_error',
            callId,
            message: `output-invalid: ${outcome.issue}`,
            latencyMs,
          };
        case 'executor-failed':
          return {
            kind: 'tool_error',
            callId,
            message: `executor-failed: ${outcome.message}`,
            latencyMs,
          };
        default:
          // Fail closed on any future BrainToolOutcome variant. The
          // explicit cases above cover the current union; a new variant
          // surfaces here as a tool_error rather than silently passing.
          return {
            kind: 'tool_error',
            callId,
            message: 'unknown tool outcome',
            latencyMs,
          };
      }
    } catch (err) {
      const latencyMs = clock() - started;
      const message =
        err instanceof Error ? err.message : 'tool dispatch error';
      config.logger?.warn('tool-dispatcher runTool threw', {
        toolName,
        reason: message,
      });
      return { kind: 'tool_error', callId, message, latencyMs };
    }
  }

  async function dispatchSpawn(
    decision: Extract<Decision, { kind: 'spawn_sub_md' }>,
  ): Promise<DispatchResult> {
    const { spawn } = decision;
    const background = Boolean(spawn.background ?? spawn.fireAndForget);
    if (config.spawnHandler) {
      try {
        const { handoffToken } = await config.spawnHandler(spawn);
        return {
          kind: 'spawn_ack',
          subMdId: spawn.subMdId,
          handoffToken,
          ...(background ? { background: true } : {}),
        };
      } catch (err) {
        config.logger?.warn('tool-dispatcher spawnHandler threw', {
          subMdId: spawn.subMdId,
          reason: err instanceof Error ? err.message : 'spawn error',
        });
        // Fall through to the breadcrumb ack so the parent loop continues.
      }
    }
    return {
      kind: 'spawn_ack',
      subMdId: spawn.subMdId,
      handoffToken: nextHandoff(),
      ...(background ? { background: true } : {}),
    };
  }

  return {
    async dispatch(
      decision: Decision,
      _ctx: HookContext,
    ): Promise<DispatchResult> {
      switch (decision.kind) {
        case 'tool_call':
          return dispatchToolCall(decision);
        case 'respond_to_owner':
        case 'final':
          return {
            kind: 'response',
            text: decision.text,
            tokensIn: 0,
            tokensOut: 0,
            usdCost: 0,
          };
        case 'schedule_wake':
          return {
            kind: 'wake_ack',
            resumeToken: decision.wake.resumeToken ?? decision.wake.wakeAt,
          };
        case 'monitor':
          return { kind: 'monitor_ack', watchId: decision.watch.watchId };
        case 'spawn_sub_md':
          return dispatchSpawn(decision);
        default:
          // Fail closed over the closed Decision union. Every current
          // variant is handled above; a new one surfaces as a tool_error.
          return {
            kind: 'tool_error',
            callId: 'unknown',
            message: 'unknown decision kind',
            latencyMs: 0,
          };
      }
    },
  };
}
