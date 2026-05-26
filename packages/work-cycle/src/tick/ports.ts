/**
 * Tick runner ports.
 *
 * The runner depends on five abstractions injected at construction:
 *   - PolicyGate  — checks the proposed tool call against the mutation-
 *                   authority tier (spec §8). Night mode defaults to T0.
 *   - ToolBag     — selects + executes the capability that fits the
 *                   current pending threads. Returns a TickOutput plus
 *                   estimated cost in USD-cents.
 *   - QualityGate — runs the 5-layer-loop checks (FLLA citation, brand,
 *                   factual, regulatory, friction). On fail, downgrades
 *                   to a `failed` output rather than silently passing.
 *   - MemoryPort  — cognitive-memory recall. Returns the top-k cells
 *                   relevant to the pending threads.
 *   - BudgetGate  — re-exported here for the runner's dependency
 *                   signature; the actual impl lives in
 *                   ../budget/night-budget.ts.
 *
 * Every port is a pure async function — no globals, no side effects
 * outside the injected dependencies.
 */

import type {
  MutationTier,
  TickInput,
  TickOutput,
  WorkCycleMode,
} from '../types.js';

// ---------------------------------------------------------------------------
// Policy gate
// ---------------------------------------------------------------------------

export interface PolicyDecision {
  readonly allowed: boolean;
  readonly reason?: 'tier_blocked' | 'night_restriction' | 'killswitch';
  readonly tier: MutationTier;
}

export interface PolicyGate {
  /**
   * Inspect the proposed tool's authority tier against the current
   * mode. Night mode default: T0 read-only unless the tool's id is
   * in `nightAllowlist`.
   */
  check(args: {
    readonly tenantId: string;
    readonly mode: WorkCycleMode;
    readonly toolTier: MutationTier;
    readonly toolId: string;
  }): Promise<PolicyDecision>;
}

export interface PolicyGateOptions {
  /**
   * Tools allowed at night beyond T0. Default: empty set (T0 only).
   */
  readonly nightAllowlist?: ReadonlyArray<string>;
}

export function createDefaultPolicyGate(
  options: PolicyGateOptions = {},
): PolicyGate {
  const allowlist = new Set<string>(options.nightAllowlist ?? []);
  return {
    async check({ mode, toolTier, toolId }) {
      if (toolTier === 't2-critical') {
        // Critical always pages — never auto-fires.
        return { allowed: false, reason: 'killswitch', tier: toolTier };
      }
      if (mode === 'night') {
        if (toolTier === 't0') {
          return { allowed: true, tier: toolTier };
        }
        if (toolTier === 't1' && allowlist.has(toolId)) {
          return { allowed: true, tier: toolTier };
        }
        return { allowed: false, reason: 'night_restriction', tier: toolTier };
      }
      if (mode === 'observe') {
        // Observe: T0 only.
        if (toolTier === 't0') {
          return { allowed: true, tier: toolTier };
        }
        return { allowed: false, reason: 'tier_blocked', tier: toolTier };
      }
      // active + idle: T0, T1 are autonomous; T2 queues for approval
      // upstream (caller is expected to not pass T2 to the runner —
      // those events are surfaced to the morning queue, not run here).
      if (toolTier === 't2') {
        return { allowed: false, reason: 'tier_blocked', tier: toolTier };
      }
      return { allowed: true, tier: toolTier };
    },
  };
}

// ---------------------------------------------------------------------------
// Tool bag
// ---------------------------------------------------------------------------

export interface ToolInvocation {
  readonly tool_id: string;
  readonly tier: MutationTier;
  readonly output: TickOutput;
  readonly estimated_cost_usd_cents: number;
}

export interface ToolBag {
  /**
   * Select-and-invoke the capability that best fits the tick input.
   * Returns the chosen tool's id, tier, output, and estimated cost.
   * Returns null if no tool fits — the runner then writes a `skipped`
   * journal row.
   */
  selectAndInvoke(input: TickInput): Promise<ToolInvocation | null>;
}

// ---------------------------------------------------------------------------
// Quality gate
// ---------------------------------------------------------------------------

export interface QualityVerdict {
  readonly ok: boolean;
  readonly failed_gate?:
    | 'citation'
    | 'brand'
    | 'factual'
    | 'regulatory'
    | 'friction';
  readonly notes?: string;
}

export interface QualityGate {
  /**
   * Run the 5-layer-loop checks on a tick output. The runner downgrades
   * a failing output to status='failed' with the gate name in `reason`.
   */
  check(output: TickOutput): Promise<QualityVerdict>;
}

export function createPassThroughQualityGate(): QualityGate {
  return {
    async check() {
      return { ok: true };
    },
  };
}

// ---------------------------------------------------------------------------
// Memory port (cognitive-memory recall)
// ---------------------------------------------------------------------------

export interface MemoryPort {
  /**
   * Return up to `k` cells relevant to the pending threads. Returns
   * `{ id, text }` pairs only — the work cycle does not need the full
   * cell projection. The host can wire this to `createRecall` from
   * `@borjie/cognitive-memory`.
   */
  recall(args: {
    readonly tenantId: string;
    readonly pendingThreadTitles: ReadonlyArray<string>;
    readonly k: number;
  }): Promise<ReadonlyArray<{ readonly id: string; readonly text: string }>>;
}

export function createNullMemoryPort(): MemoryPort {
  return {
    async recall() {
      return [];
    },
  };
}
