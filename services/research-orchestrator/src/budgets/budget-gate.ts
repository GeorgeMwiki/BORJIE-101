/**
 * Budget gate — wraps a CostTracker + OwnerConfirmGate for a single plan.
 *
 * Per DEEP_RESEARCH_SPEC §9 (Cost + latency controls) + §12 anti-pattern
 * 3 ("MUST NOT exceed budget without owner reconfirmation"), every plan
 * carries:
 *   - a hard total budget in USD cents
 *   - optional owner-confirm gates (deep-dive: [$5, $15])
 *   - a hard latency ceiling (the orchestrator aborts steps in flight
 *     when the wall-clock crosses it)
 *
 * This module is the orchestrator-side wrapper around the lower-level
 * cost-tracker primitive. It surfaces three signals the plan-runner
 * consumes:
 *
 *   - reserve(estCents): may we spend ~estCents on the next step?
 *   - commit(actualCents): record the actual spend after the step.
 *   - needsOwnerConfirm(): has a deep-dive owner-confirm gate been
 *     crossed but not yet acknowledged? (true ⇒ pause the plan.)
 *
 * Pure ports — the orchestrator wires real persistence via
 * SessionRepository.checkpointBudget().
 *
 * @module research-orchestrator/budgets/budget-gate
 */

import type { CostTracker, OwnerConfirmGate } from '../types.js';

// ---------------------------------------------------------------------------
// CostTracker — atomic reserve / commit / release
// ===========================================================================

export interface CostTrackerOptions {
  readonly budget_usd_cents: number;
  /** Optional initial spend (for resumed plans). Default 0. */
  readonly initial_spent_cents?: number;
}

interface MutableLedger {
  reserved: number;
  committed: number;
}

/**
 * Build a fresh tracker for a plan. Mirrors the contract in
 * `@borjie/research-tools/budgets/cost-tracker` so the orchestrator and
 * the adapter layer share the same shape.
 */
export function createCostTracker(options: CostTrackerOptions): CostTracker {
  const budget = Math.max(0, Math.floor(options.budget_usd_cents));
  const ledger: MutableLedger = {
    reserved: 0,
    committed: Math.max(0, options.initial_spent_cents ?? 0),
  };

  return {
    async tryReserve(estimated_cents: number): Promise<boolean> {
      const est = Math.max(0, Math.ceil(estimated_cents));
      if (ledger.committed + ledger.reserved + est > budget) {
        return false;
      }
      ledger.reserved += est;
      return true;
    },
    async commit(measured_cents: number): Promise<void> {
      const measured = Math.max(0, Math.ceil(measured_cents));
      ledger.committed += measured;
      ledger.reserved = Math.max(0, ledger.reserved - measured);
    },
    async release(reserved_cents: number): Promise<void> {
      const r = Math.max(0, Math.ceil(reserved_cents));
      ledger.reserved = Math.max(0, ledger.reserved - r);
    },
    async spent(): Promise<number> {
      return ledger.committed;
    },
    budget(): number {
      return budget;
    },
  };
}

// ---------------------------------------------------------------------------
// OwnerConfirmGate — deep-dive $5 / $15 gates
// ===========================================================================

export interface OwnerConfirmGateOptions {
  /** Gate amounts in USD dollars, e.g. [5, 15] for the spec default. */
  readonly gates_usd: ReadonlyArray<number>;
  /**
   * Already-acknowledged gates. The orchestrator persists these to
   * `research_sessions.state` so a gate isn't re-fired after ack.
   */
  readonly acknowledged_gates_usd?: ReadonlyArray<number>;
}

export function createOwnerConfirmGate(
  options: OwnerConfirmGateOptions,
): OwnerConfirmGate {
  const gatesCents = [...options.gates_usd]
    .map((g) => Math.round(g * 100))
    .sort((a, b) => a - b);
  const acked = new Set(
    (options.acknowledged_gates_usd ?? []).map((g) => Math.round(g * 100)),
  );

  return {
    needsConfirm(currentSpendCents: number): boolean {
      for (const gate of gatesCents) {
        if (currentSpendCents >= gate && !acked.has(gate)) {
          return true;
        }
      }
      return false;
    },
  };
}

export const NEVER_GATES: OwnerConfirmGate = {
  needsConfirm: () => false,
};

// ---------------------------------------------------------------------------
// BudgetGate — composes tracker + gate + latency clock
// ===========================================================================

export interface BudgetGateOptions {
  readonly budget_usd_cents: number;
  readonly latency_ms: number;
  readonly owner_confirm_gates_usd?: ReadonlyArray<number>;
  readonly acknowledged_gates_usd?: ReadonlyArray<number>;
  readonly initial_spent_cents?: number;
  /** Override the wall-clock for tests. */
  readonly now?: () => number;
}

export interface BudgetGate {
  readonly tracker: CostTracker;
  readonly ownerConfirm: OwnerConfirmGate;
  /** Returns true if the latency budget has elapsed since `start()`. */
  isLatencyExceeded(): boolean;
  /** Mark the start of the plan run. */
  start(): void;
  /** Returns the latency ceiling in ms. */
  latencyMs(): number;
  /** Returns the current elapsed wall-clock ms since start. */
  elapsedMs(): number;
  /** Returns true when the plan is over a gate that hasn't been acknowledged. */
  shouldPauseForOwner(currentSpendCents: number): boolean;
  /** Compose a per-plan reservation check + owner gate in one call. */
  canSpend(estimated_cents: number, currentSpendCents: number): Promise<boolean>;
}

/**
 * Build a BudgetGate bound to a single plan. The runner calls
 * `start()` once and `canSpend()` before each step.
 */
export function createBudgetGate(options: BudgetGateOptions): BudgetGate {
  const now = options.now ?? Date.now;
  const tracker = createCostTracker({
    budget_usd_cents: options.budget_usd_cents,
    ...(options.initial_spent_cents !== undefined
      ? { initial_spent_cents: options.initial_spent_cents }
      : {}),
  });
  const ownerConfirm =
    options.owner_confirm_gates_usd && options.owner_confirm_gates_usd.length > 0
      ? createOwnerConfirmGate({
          gates_usd: options.owner_confirm_gates_usd,
          ...(options.acknowledged_gates_usd !== undefined
            ? { acknowledged_gates_usd: options.acknowledged_gates_usd }
            : {}),
        })
      : NEVER_GATES;

  let startedAt: number | null = null;

  return {
    tracker,
    ownerConfirm,
    start(): void {
      startedAt = now();
    },
    isLatencyExceeded(): boolean {
      if (startedAt === null) return false;
      return now() - startedAt > options.latency_ms;
    },
    latencyMs(): number {
      return options.latency_ms;
    },
    elapsedMs(): number {
      if (startedAt === null) return 0;
      return now() - startedAt;
    },
    shouldPauseForOwner(currentSpendCents: number): boolean {
      return ownerConfirm.needsConfirm(currentSpendCents);
    },
    async canSpend(
      estimated_cents: number,
      currentSpendCents: number,
    ): Promise<boolean> {
      if (this.isLatencyExceeded()) return false;
      if (this.shouldPauseForOwner(currentSpendCents)) return false;
      return tracker.tryReserve(estimated_cents);
    },
  };
}
