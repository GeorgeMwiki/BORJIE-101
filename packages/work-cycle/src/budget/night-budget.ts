/**
 * Per-tenant daily $-cap gate (spec §7).
 *
 * Three caps:
 *   - night   →  500 ¢ ($5/tenant/day) — default
 *   - idle    → 2000 ¢
 *   - active  → 10000 ¢
 *   - observe →    0 ¢ (no spend permitted)
 *
 * Pure logic — accounting is delegated to a `BudgetLedger` so the SQL
 * implementation can SUM the rolling 24h window once at boot and keep
 * an LRU in memory thereafter. The in-memory ledger here is the
 * reference impl used by tests and by the worker before DB plumbing
 * lands.
 *
 * `canAffordTick` returns:
 *   - { allowed: true }
 *   - { allowed: false, reason: 'cap_reached' | 'mode_locked' }
 *
 * `mode_locked` is returned when the mode is `observe` — no spend is
 * permitted there regardless of cap.
 */

import type { WorkCycleMode } from '../types.js';

export interface BudgetCaps {
  readonly nightDailyCapUsdCents: number;
  readonly idleDailyCapUsdCents: number;
  readonly activeDailyCapUsdCents: number;
}

export const DEFAULT_BUDGET_CAPS: BudgetCaps = Object.freeze({
  nightDailyCapUsdCents: 500,
  idleDailyCapUsdCents: 2_000,
  activeDailyCapUsdCents: 10_000,
});

export interface BudgetLedger {
  /**
   * Total cost spent in the rolling 24h window for `tenantId`.
   */
  spentLast24hCents(tenantId: string): Promise<number>;
  /**
   * Record a successful spend; the in-memory impl appends with
   * timestamp so the rolling window can be computed.
   */
  recordSpend(args: {
    readonly tenantId: string;
    readonly amountUsdCents: number;
    readonly atIso: string;
  }): Promise<void>;
}

export interface BudgetDecision {
  readonly allowed: boolean;
  readonly reason?: 'cap_reached' | 'mode_locked';
  readonly cap_usd_cents: number;
  readonly spent_usd_cents: number;
}

export interface BudgetGate {
  canAffordTick(args: {
    readonly tenantId: string;
    readonly mode: WorkCycleMode;
    readonly estimatedCostCents: number;
  }): Promise<BudgetDecision>;
  /** Called after a successful tick to update the ledger. */
  recordSpend(args: {
    readonly tenantId: string;
    readonly amountUsdCents: number;
    readonly atIso: string;
  }): Promise<void>;
}

export function capForMode(mode: WorkCycleMode, caps: BudgetCaps): number {
  switch (mode) {
    case 'night':
      return caps.nightDailyCapUsdCents;
    case 'idle':
      return caps.idleDailyCapUsdCents;
    case 'active':
      return caps.activeDailyCapUsdCents;
    case 'observe':
      return 0;
  }
}

export function createBudgetGate(args: {
  readonly caps?: BudgetCaps;
  readonly ledger: BudgetLedger;
}): BudgetGate {
  const caps = args.caps ?? DEFAULT_BUDGET_CAPS;
  const ledger = args.ledger;

  return {
    async canAffordTick(input) {
      const cap = capForMode(input.mode, caps);
      const spent = await ledger.spentLast24hCents(input.tenantId);
      if (input.mode === 'observe') {
        // Observe mode is read-only — even a 0-cost tick is "allowed"
        // only if no spend is requested.
        if (input.estimatedCostCents === 0) {
          return { allowed: true, cap_usd_cents: 0, spent_usd_cents: spent };
        }
        return {
          allowed: false,
          reason: 'mode_locked',
          cap_usd_cents: 0,
          spent_usd_cents: spent,
        };
      }
      if (spent + input.estimatedCostCents > cap) {
        return {
          allowed: false,
          reason: 'cap_reached',
          cap_usd_cents: cap,
          spent_usd_cents: spent,
        };
      }
      return {
        allowed: true,
        cap_usd_cents: cap,
        spent_usd_cents: spent,
      };
    },

    async recordSpend(input) {
      if (input.amountUsdCents <= 0) return;
      await ledger.recordSpend(input);
    },
  };
}

// ---------------------------------------------------------------------------
// Reference in-memory ledger
// ---------------------------------------------------------------------------

/**
 * In-memory ledger keyed by tenantId. Each entry is `(amount, atIso)`.
 * `spentLast24hCents` filters by `at >= now - 24h`. Used by tests and
 * by the in-process worker before SQL is wired.
 */
export function createInMemoryBudgetLedger(args?: {
  readonly now?: () => Date;
}): BudgetLedger {
  type Row = { readonly amount: number; readonly atIso: string };
  const store: Map<string, Row[]> = new Map();
  const nowFn = args?.now ?? (() => new Date());

  return {
    async spentLast24hCents(tenantId) {
      const rows = store.get(tenantId);
      if (!rows || rows.length === 0) return 0;
      const cutoffMs = nowFn().getTime() - 24 * 60 * 60 * 1000;
      let total = 0;
      for (const row of rows) {
        if (new Date(row.atIso).getTime() >= cutoffMs) {
          total += row.amount;
        }
      }
      return total;
    },

    async recordSpend({ tenantId, amountUsdCents, atIso }) {
      const existing = store.get(tenantId) ?? [];
      store.set(tenantId, [...existing, { amount: amountUsdCents, atIso }]);
    },
  };
}
