/**
 * AOP runner — executes one AOPSpec against one request and captures a
 * trace.
 *
 * Wire-agnostic: the actual LLM call is abstracted behind `AOPExecutor`
 * so this file has no @anthropic-ai / @openai dependency. In production
 * the composition root wires an executor that drives `central-
 * intelligence/agent-loop.ts` under the AOP's system prompt + tool
 * subset; tests inject a deterministic stub executor.
 *
 * Trace shape mirrors Glean's "every agent run is a trace edge"
 * pattern (see audit/09-closed-loop-company-os.md §2 "Glean — Work AI
 * closed-loop knowledge graph"): inputs, tool calls, latency, final
 * output, success flag — enough for downstream eval + regression
 * scoring.
 */

import type { AOPSpec } from './aop-spec.js';

// ─────────────────────────────────────────────────────────────────────
// Request / response
// ─────────────────────────────────────────────────────────────────────

export interface AOPRequest {
  /** The user message to run the AOP against. */
  readonly userMessage: string;
  /**
   * Opaque correlation id — propagated into the trace. Useful for
   * stitching AOP traces back to a parent agent thread. Optional so
   * regression runs (which have no parent thread) can pass.
   */
  readonly threadId?: string;
  /** Free-form contextual metadata. Never inspected by the runner. */
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface AOPToolCallTrace {
  readonly toolName: string;
  readonly input: Readonly<Record<string, unknown>>;
  readonly output: unknown;
  readonly ok: boolean;
  readonly errorMessage?: string;
  readonly durationMs: number;
}

export interface AOPTrace {
  readonly aopId: string;
  readonly aopVersion: string;
  readonly threadId?: string;
  readonly userMessage: string;
  readonly finalOutput: string;
  readonly toolCalls: ReadonlyArray<AOPToolCallTrace>;
  readonly ok: boolean;
  readonly errorMessage?: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly latencyMs: number;
}

// ─────────────────────────────────────────────────────────────────────
// Executor port
// ─────────────────────────────────────────────────────────────────────

/**
 * The wire-level adapter that converts an AOPSpec + request into a
 * final answer + a list of tool calls. Returning shape mirrors the
 * trace fields the runner records.
 */
export interface AOPExecutor {
  execute(
    spec: AOPSpec,
    request: AOPRequest,
  ): Promise<{
    readonly finalOutput: string;
    readonly toolCalls: ReadonlyArray<AOPToolCallTrace>;
  }>;
}

export interface AOPRunnerDeps {
  readonly executor: AOPExecutor;
  readonly clock?: () => Date;
}

// ─────────────────────────────────────────────────────────────────────
// Runner
// ─────────────────────────────────────────────────────────────────────

export interface AOPRunner {
  run(spec: AOPSpec, request: AOPRequest): Promise<AOPTrace>;
}

export function createAOPRunner(deps: AOPRunnerDeps): AOPRunner {
  const now = deps.clock ?? (() => new Date());

  return {
    async run(spec, request) {
      const start = now();
      try {
        const { finalOutput, toolCalls } = await deps.executor.execute(spec, request);
        const end = now();
        const trace: AOPTrace = {
          aopId: spec.id,
          aopVersion: spec.version,
          ...(request.threadId !== undefined ? { threadId: request.threadId } : {}),
          userMessage: request.userMessage,
          finalOutput,
          toolCalls: Object.freeze([...toolCalls]),
          ok: toolCalls.every((c) => c.ok),
          startedAt: start.toISOString(),
          completedAt: end.toISOString(),
          latencyMs: end.getTime() - start.getTime(),
        };
        return trace;
      } catch (err) {
        const end = now();
        const message = err instanceof Error ? err.message : String(err);
        return {
          aopId: spec.id,
          aopVersion: spec.version,
          ...(request.threadId !== undefined ? { threadId: request.threadId } : {}),
          userMessage: request.userMessage,
          finalOutput: '',
          toolCalls: Object.freeze([]),
          ok: false,
          errorMessage: message,
          startedAt: start.toISOString(),
          completedAt: end.toISOString(),
          latencyMs: end.getTime() - start.getTime(),
        };
      }
    },
  };
}
