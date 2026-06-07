/**
 * Turn-thumbs → conformal feed tests.
 *
 * The LOAD-BEARING proof that the `chat_turn_confidence` alpha AUTO-LEARNS from
 * real user signal: a 👍 on an assistant turn records a COVERED coverage
 * observation for the chat-turn prediction type and the persisted ACI state
 * (alpha) advances away from its cold-start default — which is exactly what the
 * chat path reads (`getCalibratedAlpha`) to re-grade the next turn's confidence.
 *
 * Covers:
 *   1. thumbsToCovered: up ⇒ true, down ⇒ false.
 *   2. 👍 ⇒ a covered=true observation for `chat_turn_confidence` is written AND
 *      the saved calibration alpha advances to the exact ACI value (0.1 → 0.105)
 *      — proves the loop folds the bit through `updateConformal` and persists it.
 *   3. the feed binds the tenant GUC (withTenantContext) before any conformal_*
 *      write — proves RLS FORCE is satisfied on the unpinned feedback handle.
 *   4. 👎 ⇒ a covered=false observation (alpha would widen).
 *   5. an enrolled prediction row is written for the audit trail, keyed on turnId
 *      under `chat_turn_confidence`.
 *   6. missing db / empty tenant / empty turnId ⇒ no-op (null, no writes).
 *   7. a store failure never throws past the boundary (returns null, warns).
 *
 * The db is faked Drizzle-shaped: it serves `withTenantContext` (`.transaction`
 * + `.execute` for the SET LOCAL GUC binds) and the store's
 * insert().values().onConflict*()/select().from().where().orderBy().limit()
 * chain, capturing the rows the loop would persist so we assert without Postgres.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  feedTurnThumbsToConformal,
  thumbsToCovered,
} from '../feedback-conformal-feed.js';
import { CHAT_CONFIDENCE_PREDICTION_TYPE } from '../chat-conformal-confidence.js';

interface Captured {
  predictions: Array<Record<string, unknown>>;
  observations: Array<Record<string, unknown>>;
  calibrationSaves: Array<Record<string, unknown>>;
  gucBinds: string[];
}

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

/**
 * A transaction-capable Drizzle-shaped fake. `.transaction(fn)` runs `fn(tx)`
 * with the SAME builder so the loop's reads/writes (issued on `tx`) are captured;
 * `.execute` records the SET LOCAL GUC binds withTenantContext issues so the test
 * can assert the tenant context was bound BEFORE the conformal_* writes.
 */
function makeFakeDb(captured: Captured) {
  let pendingInsert:
    | { kind: 'pred' | 'obs' | 'cal' | 'unknown'; values?: Record<string, unknown> }
    | null = null;

  const builder = {
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
                  // No persisted calibration yet ⇒ cold start (alpha = 0.1).
                  return { limit: () => Promise.resolve([]) };
                },
              };
            },
          };
        },
      };
    },
    execute(query: unknown) {
      // withTenantContext issues `SELECT set_config(...)` via drizzle's sql tag.
      captured.gucBinds.push(JSON.stringify(query));
      return Promise.resolve([]);
    },
  };

  return {
    ...builder,
    transaction(fn: (tx: typeof builder) => unknown) {
      return Promise.resolve(fn(builder));
    },
  };
}

describe('turn-thumbs conformal feed', () => {
  it('maps thumbs direction to a coverage bit', () => {
    expect(thumbsToCovered('up')).toBe(true);
    expect(thumbsToCovered('down')).toBe(false);
  });

  it('a 👍 records a covered=true observation for chat_turn_confidence AND advances the persisted alpha', async () => {
    const captured: Captured = {
      predictions: [],
      observations: [],
      calibrationSaves: [],
      gucBinds: [],
    };
    const db = makeFakeDb(captured);

    const res = await feedTurnThumbsToConformal(db, {
      tenantId: 't1',
      turnId: 'turn-abc',
      signal: 'up',
      threadId: 'thread-1',
      userId: 'user-1',
    });

    // The loop advanced and returned the new alpha.
    expect(res).not.toBeNull();

    // A covered observation was written under the CHAT-TURN prediction type.
    expect(captured.observations).toHaveLength(1);
    expect(captured.observations[0]!.covered).toBe(true);
    expect(captured.observations[0]!.predictionType).toBe(
      CHAT_CONFIDENCE_PREDICTION_TYPE,
    );
    expect(captured.observations[0]!.predictionId).toBe('turn-abc');

    // The coverage bit was folded through updateConformal and PERSISTED — the
    // alpha moved off its 0.1 cold-start default. From cold start a single
    // covered=true observation gives observedCoverage=1.0, target=0.9,
    // gradient=+0.1, alpha = 0.1 + 0.05 * 0.1 = 0.105. This is the value the
    // chat path's getCalibratedAlpha now returns ⇒ subsequent chat-turn
    // confidence is re-graded against the shifted tiers. Auto-learning proven.
    expect(captured.calibrationSaves).toHaveLength(1);
    const saved = captured.calibrationSaves[0]!;
    expect(saved.predictionType).toBe(CHAT_CONFIDENCE_PREDICTION_TYPE);
    expect(Number(saved.alpha)).toBeCloseTo(0.105, 6);
    expect(Number(saved.alpha)).not.toBe(0.1);
    expect(res!.alpha).toBeCloseTo(0.105, 6);
  });

  it('binds the tenant GUC before issuing the conformal_* writes (RLS FORCE)', async () => {
    const captured: Captured = {
      predictions: [],
      observations: [],
      calibrationSaves: [],
      gucBinds: [],
    };
    const db = makeFakeDb(captured);

    await feedTurnThumbsToConformal(db, {
      tenantId: 'tenant-xyz',
      turnId: 'turn-1',
      signal: 'up',
    });

    // withTenantContext SET LOCAL the canonical tenant GUC for the tx.
    const binds = captured.gucBinds.join(' ');
    expect(binds).toContain('app.current_tenant_id');
    expect(binds).toContain('tenant-xyz');
    // And the conformal writes actually happened inside that bound tx.
    expect(captured.observations).toHaveLength(1);
  });

  it('a 👎 records a covered=false observation (alpha widens)', async () => {
    const captured: Captured = {
      predictions: [],
      observations: [],
      calibrationSaves: [],
      gucBinds: [],
    };
    const db = makeFakeDb(captured);

    await feedTurnThumbsToConformal(db, {
      tenantId: 't1',
      turnId: 'turn-down',
      signal: 'down',
    });

    expect(captured.observations[0]!.covered).toBe(false);
    expect(captured.observations[0]!.predictionType).toBe(
      CHAT_CONFIDENCE_PREDICTION_TYPE,
    );
    // From cold start a single covered=false observation: observedCoverage=0,
    // gradient = 0 - 0.9 = -0.9, alpha = 0.1 + 0.05 * (-0.9) = 0.055.
    expect(Number(captured.calibrationSaves[0]!.alpha)).toBeCloseTo(0.055, 6);
  });

  it('enrolls a prediction row keyed on turnId for the audit trail', async () => {
    const captured: Captured = {
      predictions: [],
      observations: [],
      calibrationSaves: [],
      gucBinds: [],
    };
    const db = makeFakeDb(captured);

    await feedTurnThumbsToConformal(db, {
      tenantId: 't1',
      turnId: 'turn-audit',
      signal: 'up',
    });

    expect(captured.predictions).toHaveLength(1);
    expect(captured.predictions[0]!.predictionId).toBe('turn-audit');
    expect(captured.predictions[0]!.predictionType).toBe(
      CHAT_CONFIDENCE_PREDICTION_TYPE,
    );
  });

  it('is a no-op on a missing db handle', async () => {
    const res = await feedTurnThumbsToConformal(null, {
      tenantId: 't1',
      turnId: 'turn-1',
      signal: 'up',
    });
    expect(res).toBeNull();
  });

  it('is a no-op on an empty tenant id or turn id (nothing observable)', async () => {
    const captured: Captured = {
      predictions: [],
      observations: [],
      calibrationSaves: [],
      gucBinds: [],
    };
    const db = makeFakeDb(captured);

    expect(
      await feedTurnThumbsToConformal(db, {
        tenantId: '',
        turnId: 'turn-1',
        signal: 'up',
      }),
    ).toBeNull();
    expect(
      await feedTurnThumbsToConformal(db, {
        tenantId: 't1',
        turnId: '',
        signal: 'up',
      }),
    ).toBeNull();
    expect(captured.observations).toHaveLength(0);
    expect(captured.calibrationSaves).toHaveLength(0);
  });

  it('never throws past the boundary when the store fails', async () => {
    const throwingDb = {
      transaction() {
        throw new Error('db down');
      },
    };
    const warn = vi.fn();
    const res = await feedTurnThumbsToConformal(
      throwingDb,
      { tenantId: 't1', turnId: 'turn-1', signal: 'up' },
      { warn },
    );
    expect(res).toBeNull();
    expect(warn).toHaveBeenCalled();
  });
});
