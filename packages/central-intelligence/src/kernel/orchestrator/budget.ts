/**
 * Per-session orchestrator budget — bounds the main loop on four axes:
 *
 *   - `maxTurns`      hard ceiling on while-loop iterations
 *   - `maxTokens`     cumulative input + output tokens across all sensor calls
 *   - `maxToolCalls`  total dispatched tool invocations
 *   - `maxWallMs`     wall-clock budget; checked against `clock()` not Date.now()
 *
 * The orchestrator increments after every successful dispatch and asks
 * `remaining()` before re-entering the loop. When ALL axes still have
 * headroom the loop continues; when any axis is exhausted the loop
 * collapses to a `handoffToHuman()` path.
 *
 * Immutable updates — `consume()` returns a NEW Budget rather than
 * mutating in place, so concurrent inspectors (telemetry exporters,
 * test fixtures) keep their snapshot.
 */

import type { DispatchResult } from './decision.js';

// ─────────────────────────────────────────────────────────────────────
// Constants — caller overrides via `Budget.of(...)`.
// ─────────────────────────────────────────────────────────────────────

export const DEFAULT_MAX_TURNS = 20;
export const DEFAULT_MAX_TOKENS = 80_000;
export const DEFAULT_MAX_TOOL_CALLS = 30;
export const DEFAULT_MAX_WALL_MS = 60_000;

// ─────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────

export interface BudgetLimits {
  readonly maxTurns: number;
  readonly maxTokens: number;
  readonly maxToolCalls: number;
  readonly maxWallMs: number;
}

export interface BudgetUsage {
  readonly turns: number;
  readonly tokens: number;
  readonly toolCalls: number;
  readonly wallMs: number;
  readonly usdCost: number;
}

export interface BudgetSnapshot {
  readonly limits: BudgetLimits;
  readonly usage: BudgetUsage;
  readonly exhausted: boolean;
  readonly exhaustionAxis:
    | 'turns'
    | 'tokens'
    | 'tool-calls'
    | 'wall-ms'
    | null;
}

// ─────────────────────────────────────────────────────────────────────
// Defaults helper
// ─────────────────────────────────────────────────────────────────────

const DEFAULT_LIMITS: BudgetLimits = Object.freeze({
  maxTurns: DEFAULT_MAX_TURNS,
  maxTokens: DEFAULT_MAX_TOKENS,
  maxToolCalls: DEFAULT_MAX_TOOL_CALLS,
  maxWallMs: DEFAULT_MAX_WALL_MS,
});

const EMPTY_USAGE: BudgetUsage = Object.freeze({
  turns: 0,
  tokens: 0,
  toolCalls: 0,
  wallMs: 0,
  usdCost: 0,
});

// ─────────────────────────────────────────────────────────────────────
// Budget — immutable accumulator.
// ─────────────────────────────────────────────────────────────────────

export class Budget {
  private readonly limits: BudgetLimits;
  private readonly usage: BudgetUsage;
  private readonly startedAt: number;
  private readonly clock: () => number;

  private constructor(
    limits: BudgetLimits,
    usage: BudgetUsage,
    startedAt: number,
    clock: () => number,
  ) {
    this.limits = limits;
    this.usage = usage;
    this.startedAt = startedAt;
    this.clock = clock;
  }

  /**
   * Construct a fresh Budget with optional overrides on each axis. Pass
   * a `clock` for deterministic wall-time tests; production uses
   * `Date.now`.
   */
  static of(
    overrides: Partial<BudgetLimits> = {},
    clock: () => number = Date.now,
  ): Budget {
    const limits: BudgetLimits = {
      maxTurns: overrides.maxTurns ?? DEFAULT_LIMITS.maxTurns,
      maxTokens: overrides.maxTokens ?? DEFAULT_LIMITS.maxTokens,
      maxToolCalls: overrides.maxToolCalls ?? DEFAULT_LIMITS.maxToolCalls,
      maxWallMs: overrides.maxWallMs ?? DEFAULT_LIMITS.maxWallMs,
    };
    return new Budget(limits, EMPTY_USAGE, clock(), clock);
  }

  /**
   * Return a new Budget reflecting one additional turn + the dispatch
   * outcome's token/tool/cost impact. Pure — does NOT mutate `this`.
   */
  consume(result: DispatchResult): Budget {
    const wallMs = this.clock() - this.startedAt;
    const nextUsage: BudgetUsage = {
      turns: this.usage.turns + 1,
      tokens: this.usage.tokens + tokensConsumed(result),
      toolCalls: this.usage.toolCalls + toolCallDelta(result),
      wallMs,
      usdCost: this.usage.usdCost + usdConsumed(result),
    };
    return new Budget(this.limits, nextUsage, this.startedAt, this.clock);
  }

  /** True when at least one axis still has room. */
  remaining(): boolean {
    return !this.exhausted();
  }

  exhausted(): boolean {
    return this.exhaustionAxis() !== null;
  }

  exhaustionAxis(): BudgetSnapshot['exhaustionAxis'] {
    const wallMs = this.clock() - this.startedAt;
    if (this.usage.turns >= this.limits.maxTurns) return 'turns';
    if (this.usage.tokens >= this.limits.maxTokens) return 'tokens';
    if (this.usage.toolCalls >= this.limits.maxToolCalls) return 'tool-calls';
    if (wallMs >= this.limits.maxWallMs) return 'wall-ms';
    return null;
  }

  snapshot(): BudgetSnapshot {
    const wallMs = this.clock() - this.startedAt;
    const usage: BudgetUsage = { ...this.usage, wallMs };
    return {
      limits: this.limits,
      usage,
      exhausted: this.exhausted(),
      exhaustionAxis: this.exhaustionAxis(),
    };
  }
}

// ─────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────

function tokensConsumed(result: DispatchResult): number {
  switch (result.kind) {
    case 'tool_ok':
    case 'response':
      return result.tokensIn + result.tokensOut;
    default:
      return 0;
  }
}

function toolCallDelta(result: DispatchResult): number {
  switch (result.kind) {
    case 'tool_ok':
    case 'tool_error':
      return 1;
    default:
      return 0;
  }
}

function usdConsumed(result: DispatchResult): number {
  switch (result.kind) {
    case 'tool_ok':
    case 'response':
      return result.usdCost;
    default:
      return 0;
  }
}
