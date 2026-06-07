/**
 * Reconciliation → conformal feed tests.
 *
 * Covers the OUTCOME-side wiring that makes alpha LEARN from real reconciliations:
 *   1. conformalTypeForAction namespaces + sanitises action_kind.
 *   2. matched ⇒ covered=true is recorded (alpha advances).
 *   3. divergent ⇒ covered=false is recorded.
 *   4. undetermined / expired ⇒ SKIPPED (returns null, no store writes).
 *   5. a predicted scalar produces a ±band interval on the enrolled prediction.
 *   6. a missing db handle is a no-op (returns null).
 *
 * The store is faked via a Drizzle-shaped stub that captures the rows the loop
 * would persist, so we assert the loop folds the coverage bit through without a
 * real Postgres.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  feedReconciliationToConformal,
  conformalTypeForAction,
} from '../reconciliation-conformal-feed.js';

interface Captured {
  predictions: Array<Record<string, unknown>>;
  observations: Array<Record<string, unknown>>;
  calibrationSaves: Array<Record<string, unknown>>;
}

/**
 * Minimal Drizzle-shaped fake covering exactly the builder calls the conformal
 * store makes: insert().values().onConflictDoUpdate()/onConflictDoNothing() and
 * select().from().where().orderBy().limit().
 */
function makeFakeDb(captured: Captured) {
  // Identify the table by its presence in the chain; the store passes the table
  // object first to insert()/from(). We tag rows by which array fills.
  let pendingInsert: { kind: 'pred' | 'obs' | 'cal' | 'unknown'; values?: Record<string, unknown> } | null =
    null;

  function tableName(t: unknown): string {
    if (!t || typeof t !== 'object') return '';
    const sym = Object.getOwnPropertySymbols(t).find(
      (s) => s.toString() === 'Symbol(drizzle:Name)',
    );
    return sym ? String((t as Record<symbol, unknown>)[sym] ?? '') : '';
  }

  function tableKind(t: unknown): 'pred' | 'obs' | 'cal' | 'unknown' {
    const name = tableName(t);
    if (name.includes('prediction')) return 'pred';
    if (name.includes('observation')) return 'obs';
    if (name.includes('calibration')) return 'cal';
    return 'unknown';
  }

  const db = {
    insert(table: unknown) {
      pendingInsert = { kind: tableKind(table) };
      return {
        values(v: Record<string, unknown>) {
          if (pendingInsert) pendingInsert.values = v;
          const finish = () => {
            if (!pendingInsert) return Promise.resolve();
            if (pendingInsert.kind === 'pred')
              captured.predictions.push(pendingInsert.values ?? {});
            else if (pendingInsert.kind === 'obs')
              captured.observations.push(pendingInsert.values ?? {});
            else if (pendingInsert.kind === 'cal')
              captured.calibrationSaves.push(pendingInsert.values ?? {});
            pendingInsert = null;
            return Promise.resolve();
          };
          return {
            onConflictDoUpdate: finish,
            onConflictDoNothing: finish,
          };
        },
      };
    },
    select() {
      return {
        from() {
          return {
            where() {
              return {
                orderBy() {
                  return {
                    // No persisted calibration yet ⇒ cold start.
                    limit: () => Promise.resolve([]),
                  };
                },
              };
            },
          };
        },
      };
    },
  };
  return db;
}

describe('reconciliation conformal feed', () => {
  it('namespaces and sanitises the action kind into a conformal type', () => {
    expect(conformalTypeForAction('licence.renew')).toBe('action:licence.renew');
    expect(conformalTypeForAction('Royalty Assess!!')).toBe(
      'action:royalty_assess_',
    );
    expect(conformalTypeForAction('')).toBe('action:unknown');
  });

  it('records a matched reconciliation as covered=true', async () => {
    const captured: Captured = {
      predictions: [],
      observations: [],
      calibrationSaves: [],
    };
    const db = makeFakeDb(captured);
    const res = await feedReconciliationToConformal(db, {
      tenantId: 't1',
      predictionId: 'p1',
      actionKind: 'licence.renew',
      status: 'matched',
      predictedValueTzs: 1000,
      observedValueTzs: 1050,
      driftScore: 0.05,
    });
    expect(res).not.toBeNull();
    expect(captured.predictions).toHaveLength(1);
    expect(captured.observations).toHaveLength(1);
    expect(captured.observations[0]!.covered).toBe(true);
    expect(captured.observations[0]!.predictionType).toBe('action:licence.renew');
    // Coverage was folded into a saved calibration state (alpha advanced).
    expect(captured.calibrationSaves).toHaveLength(1);
  });

  it('records a divergent reconciliation as covered=false', async () => {
    const captured: Captured = {
      predictions: [],
      observations: [],
      calibrationSaves: [],
    };
    const db = makeFakeDb(captured);
    await feedReconciliationToConformal(db, {
      tenantId: 't1',
      predictionId: 'p2',
      actionKind: 'royalty.assess',
      status: 'divergent',
      predictedValueTzs: 1000,
      observedValueTzs: 4000,
      driftScore: 0.9,
    });
    expect(captured.observations[0]!.covered).toBe(false);
  });

  it('records a ±band interval from the predicted scalar', async () => {
    const captured: Captured = {
      predictions: [],
      observations: [],
      calibrationSaves: [],
    };
    const db = makeFakeDb(captured);
    await feedReconciliationToConformal(db, {
      tenantId: 't1',
      predictionId: 'p3',
      actionKind: 'licence.renew',
      status: 'matched',
      predictedValueTzs: 1000,
      observedValueTzs: 1000,
      driftScore: 0,
    });
    const row = captured.predictions[0]!;
    expect(row.predictedValue).toBe(1000);
    expect(row.predictedLower).toBeCloseTo(850, 5);
    expect(row.predictedUpper).toBeCloseTo(1150, 5);
  });

  it('SKIPS undetermined/expired (no coverage bit) and writes nothing', async () => {
    for (const status of ['undetermined', 'expired'] as const) {
      const captured: Captured = {
        predictions: [],
        observations: [],
        calibrationSaves: [],
      };
      const db = makeFakeDb(captured);
      const res = await feedReconciliationToConformal(db, {
        tenantId: 't1',
        predictionId: 'p4',
        actionKind: 'licence.renew',
        status,
        predictedValueTzs: 1000,
        observedValueTzs: null,
        driftScore: 0,
      });
      expect(res).toBeNull();
      expect(captured.predictions).toHaveLength(0);
      expect(captured.observations).toHaveLength(0);
    }
  });

  it('is a no-op when the db handle is missing', async () => {
    const res = await feedReconciliationToConformal(null, {
      tenantId: 't1',
      predictionId: 'p5',
      actionKind: 'licence.renew',
      status: 'matched',
      predictedValueTzs: null,
      observedValueTzs: null,
      driftScore: 0,
    });
    expect(res).toBeNull();
  });

  it('never throws past the boundary when the store fails', async () => {
    const throwingDb = {
      insert() {
        throw new Error('db down');
      },
      select() {
        throw new Error('db down');
      },
    };
    const warn = vi.fn();
    const res = await feedReconciliationToConformal(
      throwingDb,
      {
        tenantId: 't1',
        predictionId: 'p6',
        actionKind: 'licence.renew',
        status: 'matched',
        predictedValueTzs: 1000,
        observedValueTzs: 1000,
        driftScore: 0,
      },
      { warn },
    );
    expect(res).toBeNull();
    expect(warn).toHaveBeenCalled();
  });
});
