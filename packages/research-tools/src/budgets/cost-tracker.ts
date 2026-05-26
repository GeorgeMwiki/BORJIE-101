/**
 * Cost tracker — per-plan spend ledger with budget gates.
 *
 * Adapters MUST reserve cost BEFORE the network call and commit / release
 * after. The tracker also enforces the deep-dive owner-confirm gates at
 * $5 and $15 spent (DEEP_RESEARCH_SPEC §3.4): the gate function returns
 * true when a gate has been crossed but not yet acknowledged.
 *
 * Pure logic — caller is responsible for persisting the ledger between
 * worker pickups (the orchestrator service stamps the tracker into the
 * `research_sessions.state` jsonb column).
 *
 * @module @borjie/research-tools/budgets/cost-tracker
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
 * Build a fresh tracker for a plan. Returned value is a tagged object
 * with a getter for the closed-over ledger — needed because the spec
 * requires reserve/commit/release semantics.
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
      // A commit closes out an entire reservation cycle (adapter
      // contract: reserve → commit OR reserve → release). Drop the
      // reserved column to zero so any over-reservation is returned
      // to the budget envelope. Adapters that need multi-step holds
      // call reserve() multiple times then commit() once at the end.
      ledger.reserved = 0;
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
   * Lookup of already-acknowledged gates. The orchestrator persists
   * these to `research_sessions.state` so the gate isn't re-fired after
   * the owner clicks "continue".
   */
  readonly acknowledged_gates_usd?: ReadonlyArray<number>;
}

/**
 * Build a gate function. Returns true if the current spend has crossed
 * a gate that hasn't been acknowledged yet.
 *
 * Per spec: the dive PAUSES when this returns true. Adapters MUST
 * refuse to call until the orchestrator records the ack.
 */
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

/**
 * No-op gate — for non-deep-dive modes where the executor doesn't need
 * owner confirmation. `needsConfirm` always returns false.
 */
export const NEVER_GATES: OwnerConfirmGate = {
  needsConfirm: () => false,
};
