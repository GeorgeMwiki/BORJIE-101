import { describe, it, expect } from 'vitest';
import { applyDeltas, DeltaSyncError } from '../sync/delta-sync.js';
import { buildFreshTabSession, transitionSession } from '../repositories/tab-session.js';
import type { TabDelta, TabState } from '../types.js';

function freshState(): TabState {
  return {
    recipeId: 'tab_recipe.buyer_kyb_start',
    recipeVersion: 7,
    scopeId: 'kahama/mine-088',
    uiState: {},
    loopCursor: {
      iteration: 0,
      lastSensorAt: new Date(0).toISOString(),
      lastPolicyVerdict: 'allow',
    },
    pendingHints: [],
    frictionLedger: { score: 0, samples: 0 },
    recipeProposals: [],
  };
}

function buildSeq(): { ids: string[]; next: () => string } {
  const ids: string[] = [];
  let n = 0;
  return {
    ids,
    next: () => {
      n += 1;
      const id = `id-${n}`;
      ids.push(id);
      return id;
    },
  };
}

describe('delta-sync', () => {
  it('applies a ui.field-edit delta and increments iteration', async () => {
    const seq = buildSeq();
    const now = new Date(1_700_000_000_000);
    const session = buildFreshTabSession(
      {
        tenantId: 't1',
        userId: 'u1',
        tabKind: 'composer',
        initialState: freshState(),
      },
      { now: () => now, nextId: seq.next },
    );
    // Move into `active` so applyDeltas accepts deltas.
    const opened = transitionSession(session, 'OPEN', now);
    const hydrated = transitionSession(opened, 'HYDRATED', now);

    const delta: TabDelta = {
      kind: 'ui.field-edit',
      clientIteration: 0,
      payload: { firstName: 'Mwikila' },
    };
    const result = applyDeltas(
      hydrated,
      {
        tenantId: 't1',
        sessionId: hydrated.id,
        fromIteration: 0,
        deltas: [delta],
      },
      { now: () => now, nextId: seq.next },
    );
    expect(result.rebase).toBeNull();
    expect(result.persistedEvents.length).toBe(1);
    expect(result.session.state.loopCursor.iteration).toBe(1);
    expect(result.session.state.uiState).toEqual({ firstName: 'Mwikila' });
  });

  it('reduces friction.sample as a running mean clipped to [0,1]', async () => {
    const seq = buildSeq();
    const now = new Date(1_700_000_000_000);
    const session = buildFreshTabSession(
      {
        tenantId: 't1',
        userId: 'u1',
        tabKind: 'workflow',
        initialState: freshState(),
      },
      { now: () => now, nextId: seq.next },
    );
    const opened = transitionSession(session, 'OPEN', now);
    const hydrated = transitionSession(opened, 'HYDRATED', now);
    const r1 = applyDeltas(
      hydrated,
      {
        tenantId: 't1',
        sessionId: hydrated.id,
        fromIteration: 0,
        deltas: [
          { kind: 'friction.sample', clientIteration: 0, payload: { score: 0.4 } },
          { kind: 'friction.sample', clientIteration: 1, payload: { score: 0.6 } },
          // Out-of-range value clipped to 1.
          { kind: 'friction.sample', clientIteration: 2, payload: { score: 99 } },
        ],
      },
      { now: () => now, nextId: seq.next },
    );
    expect(r1.session.state.frictionLedger.samples).toBe(3);
    // Mean of [0.4, 0.6, 1] = 0.6666…
    expect(r1.session.state.frictionLedger.score).toBeCloseTo((0.4 + 0.6 + 1) / 3, 5);
  });

  it('returns a rebase snapshot when client cursor is behind server', async () => {
    const seq = buildSeq();
    const now = new Date(1_700_000_000_000);
    const session = buildFreshTabSession(
      {
        tenantId: 't1',
        userId: 'u1',
        tabKind: 'dashboard',
        initialState: { ...freshState(), loopCursor: { iteration: 5, lastSensorAt: 'x', lastPolicyVerdict: 'allow' } },
      },
      { now: () => now, nextId: seq.next },
    );
    const opened = transitionSession(session, 'OPEN', now);
    const hydrated = transitionSession(opened, 'HYDRATED', now);

    const result = applyDeltas(
      hydrated,
      {
        tenantId: 't1',
        sessionId: hydrated.id,
        fromIteration: 2,  // behind — should trigger rebase
        deltas: [
          { kind: 'ui.field-edit', clientIteration: 2, payload: { f: 'g' } },
        ],
      },
      { now: () => now, nextId: seq.next },
    );
    expect(result.rebase).not.toBeNull();
    expect(result.persistedEvents.length).toBe(0);
  });

  it('rejects deltas when session is not warm', async () => {
    const seq = buildSeq();
    const now = new Date(1_700_000_000_000);
    const session = buildFreshTabSession(
      {
        tenantId: 't1',
        userId: 'u1',
        tabKind: 'composer',
        initialState: freshState(),
      },
      { now: () => now, nextId: seq.next },
    );
    // Still in `opening`.
    expect(() =>
      applyDeltas(
        session,
        {
          tenantId: 't1',
          sessionId: session.id,
          fromIteration: 0,
          deltas: [{ kind: 'ui.field-edit', clientIteration: 0, payload: {} }],
        },
        { now: () => now, nextId: seq.next },
      ),
    ).toThrow(DeltaSyncError);
  });

  it('rejects batches exceeding MAX_DELTAS_PER_APPLY', async () => {
    const seq = buildSeq();
    const now = new Date();
    const session = buildFreshTabSession(
      {
        tenantId: 't1',
        userId: 'u1',
        tabKind: 'composer',
        initialState: freshState(),
      },
      { now: () => now, nextId: seq.next },
    );
    const opened = transitionSession(session, 'OPEN', now);
    const hydrated = transitionSession(opened, 'HYDRATED', now);
    const huge: TabDelta[] = Array.from({ length: 257 }, (_, i) => ({
      kind: 'lifecycle.transition' as const,
      clientIteration: i,
      payload: {},
    }));
    expect(() =>
      applyDeltas(
        hydrated,
        {
          tenantId: 't1',
          sessionId: hydrated.id,
          fromIteration: 0,
          deltas: huge,
        },
        { now: () => now, nextId: seq.next },
      ),
    ).toThrow(DeltaSyncError);
  });

  it('chains audit hashes forward across persisted events', async () => {
    const seq = buildSeq();
    const now = new Date(1_700_000_000_000);
    const session = buildFreshTabSession(
      {
        tenantId: 't1',
        userId: 'u1',
        tabKind: 'workflow',
        initialState: freshState(),
      },
      { now: () => now, nextId: seq.next },
    );
    const opened = transitionSession(session, 'OPEN', now);
    const hydrated = transitionSession(opened, 'HYDRATED', now);
    const result = applyDeltas(
      hydrated,
      {
        tenantId: 't1',
        sessionId: hydrated.id,
        fromIteration: 0,
        deltas: [
          { kind: 'lifecycle.transition', clientIteration: 0, payload: { foo: 'a' } },
          { kind: 'lifecycle.transition', clientIteration: 1, payload: { foo: 'b' } },
        ],
      },
      { now: () => now, nextId: seq.next },
    );
    expect(result.persistedEvents.length).toBe(2);
    const [first, second] = result.persistedEvents;
    expect(first?.auditHash).not.toEqual(second?.auditHash);
    expect(result.session.auditHash).toEqual(second?.auditHash);
    expect(result.session.prevHash).toEqual(hydrated.auditHash);
  });
});
