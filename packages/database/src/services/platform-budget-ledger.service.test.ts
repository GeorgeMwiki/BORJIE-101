/**
 * Unit tests for createPgPlatformBudgetLedger.
 *
 * The factory's runtime behaviour is shaped by the Drizzle query
 * builder; we cannot exercise the real Postgres `FOR UPDATE` semantics
 * here. Instead we verify the contract observed by callers:
 *   • snapshot() returns the configured totals on a fresh ledger.
 *   • reserve() updates the in-memory mirror correctly.
 *   • reserve() throws PrivacyBudgetExhaustedError once spent + new
 *     would cross totalEpsilon.
 *   • Multiple reserves accumulate.
 *
 * The DatabaseClient is stubbed by a minimal vi.fn-based mock that
 * mirrors only the chain shape the service actually walks, plus a
 * simple in-memory row store so the assertions read naturally.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  createPgPlatformBudgetLedger,
  PrivacyBudgetExhaustedError,
} from './platform-budget-ledger.service.js';
import type { DatabaseClient } from '../client.js';

// ─────────────────────────────────────────────────────────────────────
// Minimal mock: a state machine that fakes the calls
// `ensureSingleton` + `snapshot` + `reserve` make against Drizzle.
// ─────────────────────────────────────────────────────────────────────

interface BudgetRow {
  id: string;
  totalEpsilon: number;
  spentEpsilon: number;
  totalDelta: number;
  spentDelta: number;
  updatedAt: Date;
}

interface MockState {
  row: BudgetRow | null;
  reservations: Array<{ id: string; epsilon: number; delta: number }>;
}

function makeMockDb(state: MockState): DatabaseClient {
  // Each call site builds its own thenable. We wire just enough chain
  // methods that the factory's actual call shape resolves with the
  // expected shape (rows[]).
  function makeSelectChain(): unknown {
    let resolved: unknown = [];
    const chain: Record<string, unknown> = {
      from: () => chain,
      where: () => chain,
      limit: () => chain,
      for: () => chain,
      then: (resolve: (rows: unknown) => unknown) => resolve(resolved),
    };
    // Snapshot: fetch the singleton row.
    if (state.row) {
      resolved = [
        {
          totalEpsilon: state.row.totalEpsilon,
          spentEpsilon: state.row.spentEpsilon,
          totalDelta: state.row.totalDelta,
          spentDelta: state.row.spentDelta,
        },
      ];
    } else {
      resolved = [];
    }
    return chain;
  }

  function makeInsertChain(table: 'budget' | 'reservations'): unknown {
    let pendingValues: Record<string, unknown> | null = null;
    const chain: Record<string, unknown> = {
      values: (v: Record<string, unknown>) => {
        pendingValues = v;
        return chain;
      },
      onConflictDoNothing: () => {
        // budget singleton — only insert when row absent.
        if (table === 'budget' && !state.row && pendingValues) {
          state.row = {
            id: String(pendingValues['id'] ?? 'singleton'),
            totalEpsilon: Number(pendingValues['totalEpsilon']),
            spentEpsilon: Number(pendingValues['spentEpsilon'] ?? 0),
            totalDelta: Number(pendingValues['totalDelta']),
            spentDelta: Number(pendingValues['spentDelta'] ?? 0),
            updatedAt: new Date(),
          };
        }
        return chain;
      },
      then: (resolve: (rows: unknown) => unknown) => {
        // For reservations the .values(...) call ends here without
        // onConflictDoNothing — settle on await.
        if (table === 'reservations' && pendingValues) {
          state.reservations.push({
            id: String(pendingValues['id']),
            epsilon: Number(pendingValues['epsilon']),
            delta: Number(pendingValues['delta']),
          });
        }
        if (table === 'budget' && !state.row && pendingValues) {
          // ensureSingleton awaited the insert chain itself in case
          // .onConflictDoNothing wasn't called.
          state.row = {
            id: String(pendingValues['id'] ?? 'singleton'),
            totalEpsilon: Number(pendingValues['totalEpsilon']),
            spentEpsilon: Number(pendingValues['spentEpsilon'] ?? 0),
            totalDelta: Number(pendingValues['totalDelta']),
            spentDelta: Number(pendingValues['spentDelta'] ?? 0),
            updatedAt: new Date(),
          };
        }
        return resolve(undefined);
      },
    };
    return chain;
  }

  function makeUpdateChain(): unknown {
    let pendingSet: Record<string, unknown> | null = null;
    const chain: Record<string, unknown> = {
      set: (s: Record<string, unknown>) => {
        pendingSet = s;
        return chain;
      },
      where: () => chain,
      then: (resolve: (rows: unknown) => unknown) => {
        if (state.row && pendingSet) {
          if (typeof pendingSet['spentEpsilon'] === 'number') {
            state.row.spentEpsilon = pendingSet['spentEpsilon'];
          }
          if (typeof pendingSet['spentDelta'] === 'number') {
            state.row.spentDelta = pendingSet['spentDelta'];
          }
          state.row.updatedAt = new Date();
        }
        return resolve(undefined);
      },
    };
    return chain;
  }

  function pickInsertTable(table: unknown): 'budget' | 'reservations' {
    // We disambiguate by symbol-for("drizzle:Name"). The schema files
    // attach the Postgres table name to that symbol. Fall back to
    // 'budget' so the singleton-init path stays predictable.
    const nameSym = Symbol.for('drizzle:Name');
    const name = (table as Record<symbol, unknown>)[nameSym];
    if (name === 'platform_privacy_budget_reservations') return 'reservations';
    return 'budget';
  }

  const db: Record<string, unknown> = {
    select: () => makeSelectChain(),
    insert: (table: unknown) => makeInsertChain(pickInsertTable(table)),
    update: () => makeUpdateChain(),
    transaction: async <T,>(cb: (tx: unknown) => Promise<T>): Promise<T> => {
      // Inside the tx callback we hand back the same mock db. The
      // service only uses select/insert/update inside the txn.
      return cb(db as unknown);
    },
  };

  return db as unknown as DatabaseClient;
}

// ─────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────

describe('createPgPlatformBudgetLedger', () => {
  let state: MockState;
  let db: DatabaseClient;

  beforeEach(() => {
    state = { row: null, reservations: [] };
    db = makeMockDb(state);
  });

  it('rejects non-positive totalEpsilon at construction', () => {
    expect(() =>
      createPgPlatformBudgetLedger(db, { totalEpsilon: 0, totalDelta: 1e-6 }),
    ).toThrow(RangeError);
    expect(() =>
      createPgPlatformBudgetLedger(db, { totalEpsilon: -1, totalDelta: 1e-6 }),
    ).toThrow(RangeError);
  });

  it('snapshot() initialises the singleton and returns configured totals', async () => {
    const ledger = createPgPlatformBudgetLedger(db, {
      totalEpsilon: 5,
      totalDelta: 1e-6,
    });
    const snap = await ledger.snapshot();
    expect(snap).toEqual({
      totalEpsilon: 5,
      spentEpsilon: 0,
      totalDelta: 1e-6,
      spentDelta: 0,
    });
    expect(state.row?.id).toBe('singleton');
  });

  it('reserve() updates spent counters on success', async () => {
    const ledger = createPgPlatformBudgetLedger(db, {
      totalEpsilon: 5,
      totalDelta: 1e-6,
    });
    const out = await ledger.reserve({ epsilon: 1.5, delta: 0 });
    expect(out.remainingEpsilon).toBeCloseTo(3.5, 6);
    expect(out.remainingDelta).toBeCloseTo(1e-6, 12);
    expect(state.row?.spentEpsilon).toBeCloseTo(1.5, 6);
    expect(state.reservations).toHaveLength(1);
    expect(state.reservations[0]?.epsilon).toBe(1.5);
  });

  it('reserve() rejects when epsilon would exhaust the budget', async () => {
    const ledger = createPgPlatformBudgetLedger(db, {
      totalEpsilon: 1,
      totalDelta: 1e-6,
    });
    await expect(ledger.reserve({ epsilon: 1.5, delta: 0 })).rejects.toBeInstanceOf(
      PrivacyBudgetExhaustedError,
    );
    // No state mutation on failure.
    expect(state.row?.spentEpsilon).toBe(0);
    expect(state.reservations).toHaveLength(0);
  });

  it('reserve() rejects when delta would exhaust the delta budget', async () => {
    const ledger = createPgPlatformBudgetLedger(db, {
      totalEpsilon: 5,
      totalDelta: 1e-6,
    });
    await expect(
      ledger.reserve({ epsilon: 0.1, delta: 2e-6 }),
    ).rejects.toBeInstanceOf(PrivacyBudgetExhaustedError);
    expect(state.row?.spentEpsilon).toBe(0);
  });

  it('multiple reserves accumulate on the singleton row', async () => {
    const ledger = createPgPlatformBudgetLedger(db, {
      totalEpsilon: 5,
      totalDelta: 1e-6,
    });
    await ledger.reserve({ epsilon: 1, delta: 1e-7 });
    await ledger.reserve({ epsilon: 2, delta: 2e-7 });
    const snap = await ledger.snapshot();
    expect(snap.spentEpsilon).toBeCloseTo(3, 6);
    expect(snap.spentDelta).toBeCloseTo(3e-7, 12);
    expect(state.reservations).toHaveLength(2);
  });

  it('reserve() throws RangeError on non-positive epsilon', async () => {
    const ledger = createPgPlatformBudgetLedger(db, {
      totalEpsilon: 5,
      totalDelta: 1e-6,
    });
    await expect(ledger.reserve({ epsilon: 0, delta: 0 })).rejects.toBeInstanceOf(
      RangeError,
    );
    await expect(ledger.reserve({ epsilon: -1, delta: 0 })).rejects.toBeInstanceOf(
      RangeError,
    );
  });
});
