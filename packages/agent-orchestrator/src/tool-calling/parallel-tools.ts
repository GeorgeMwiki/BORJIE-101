/**
 * Parallel tool execution (Anthropic parallel tool-call pattern).
 *
 * When the model emits N independent tool calls in one turn, dispatch
 * them concurrently with a bounded `maxConcurrency` and return an
 * ordered result array. Failures DO NOT short-circuit the batch — the
 * model gets one observation per call (success or error).
 */

import type { BrainToolCall, ToolPort } from '../types.js';

export interface ToolResult {
  readonly id: string;
  readonly name: string;
  readonly ok: boolean;
  readonly output?: unknown;
  readonly error?: string;
  readonly latencyMs: number;
}

export interface RunParallelToolsInput {
  readonly calls: ReadonlyArray<BrainToolCall>;
  readonly tools: ReadonlyArray<ToolPort>;
  readonly maxConcurrency?: number;
  /** Optional clock injection (for deterministic tests). */
  readonly clock?: () => number;
}

export const DEFAULT_PARALLEL_CONCURRENCY = 8;

export async function runParallelTools(input: RunParallelToolsInput): Promise<ReadonlyArray<ToolResult>> {
  const concurrency = Math.max(1, input.maxConcurrency ?? DEFAULT_PARALLEL_CONCURRENCY);
  const clock = input.clock ?? Date.now;
  const toolMap = new Map(input.tools.map((t) => [t.name, t]));
  const results: ToolResult[] = new Array(input.calls.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < input.calls.length) {
      const myIndex = cursor++;
      const call = input.calls[myIndex];
      if (!call) continue;
      const tool = toolMap.get(call.name);
      const start = clock();
      if (!tool) {
        results[myIndex] = {
          id: call.id,
          name: call.name,
          ok: false,
          error: `tool not found: ${call.name}`,
          latencyMs: clock() - start,
        };
        continue;
      }
      try {
        const out = await tool.execute(call.input);
        results[myIndex] = {
          id: call.id,
          name: call.name,
          ok: true,
          output: out,
          latencyMs: clock() - start,
        };
      } catch (err) {
        results[myIndex] = {
          id: call.id,
          name: call.name,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
          latencyMs: clock() - start,
        };
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, input.calls.length) }, () => worker());
  await Promise.all(workers);
  return results;
}
