/**
 * PreToolUse: rate-limit hook — denies a tool call when the caller has
 * exceeded the per-thread / per-tool quota in the current window.
 *
 * The counter port is injectable; production binds a Redis-backed
 * sliding window, tests use the in-memory counter below.
 */

import type { Decision } from '../../decision.js';
import type { HookContext, HookResult, PreToolUseHook } from '../../hook-chain.js';

// ─────────────────────────────────────────────────────────────────────
// Port
// ─────────────────────────────────────────────────────────────────────

export interface RateLimitCounter {
  /** Increment + return current count for the (thread, tool, window) key. */
  incrementAndCount(args: {
    readonly threadId: string;
    readonly toolName: string;
    readonly windowMs: number;
  }): Promise<number>;
}

export interface RateLimitHookDeps {
  readonly counter: RateLimitCounter;
  readonly maxCallsPerWindow: number;
  readonly windowMs: number;
}

// ─────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────

export function createRateLimitHook(deps: RateLimitHookDeps): PreToolUseHook {
  return {
    name: 'rate-limit',
    stage: 'pre-tool-use',
    async fn(ctx: HookContext, decision: Decision): Promise<HookResult> {
      if (decision.kind !== 'tool_call') return { kind: 'allow' };
      const count = await deps.counter.incrementAndCount({
        threadId: ctx.threadId,
        toolName: decision.call.toolName,
        windowMs: deps.windowMs,
      });
      if (count <= deps.maxCallsPerWindow) return { kind: 'allow' };
      return {
        kind: 'deny',
        code: 'rate-limit-exceeded',
        reason: `tool '${decision.call.toolName}' called ${count} times in last ${deps.windowMs}ms (limit ${deps.maxCallsPerWindow})`,
      };
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// In-memory counter — fixture.
// ─────────────────────────────────────────────────────────────────────

export function createInMemoryRateLimitCounter(
  clock: () => number = Date.now,
): RateLimitCounter {
  const buckets = new Map<string, number[]>();
  return {
    async incrementAndCount(args): Promise<number> {
      const key = `${args.threadId}::${args.toolName}`;
      const now = clock();
      const cutoff = now - args.windowMs;
      const existing = (buckets.get(key) ?? []).filter((t) => t >= cutoff);
      existing.push(now);
      buckets.set(key, existing);
      return existing.length;
    },
  };
}
