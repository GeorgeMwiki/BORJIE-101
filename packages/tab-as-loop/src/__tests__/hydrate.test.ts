import { describe, it, expect } from 'vitest';
import { hydrateSession, HydrateError } from '../sync/hydrate.js';
import { applyDeltas } from '../sync/delta-sync.js';
import {
  buildFreshTabSession,
  createInMemoryTabSessionRepository,
  transitionSession,
} from '../repositories/tab-session.js';
import { createInMemoryTabEventRepository } from '../repositories/tab-event.js';
import type { TabState } from '../types.js';

function freshState(): TabState {
  return {
    recipeId: 'tab_recipe.tumemadini_filing',
    recipeVersion: 3,
    scopeId: 'tabora',
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

function seq(): () => string {
  let n = 0;
  return () => {
    n += 1;
    return `id-${n}`;
  };
}

describe('hydrate', () => {
  it('hydrates a freshly opened session into active', async () => {
    const sessions = createInMemoryTabSessionRepository();
    const events = createInMemoryTabEventRepository();
    const now = () => new Date(1_700_000_000_000);
    const nextId = seq();
    const session = buildFreshTabSession(
      {
        tenantId: 't1',
        userId: 'u1',
        tabKind: 'workflow',
        initialState: freshState(),
      },
      { now, nextId },
    );
    await sessions.insert(session);

    const result = await hydrateSession(
      {
        tenantId: 't1',
        sessionId: session.id,
        clientIteration: 0,
      },
      { sessions, events, now },
    );
    expect(result.session.lifecycleState).toBe('active');
    expect(result.snapshotIteration).toBe(0);
    expect(result.eventsApplied).toBe(0);
  });

  it('returns newer events when client cursor is behind server', async () => {
    const sessions = createInMemoryTabSessionRepository();
    const events = createInMemoryTabEventRepository();
    const now = () => new Date(1_700_000_000_000);
    const nextId = seq();
    let session = buildFreshTabSession(
      {
        tenantId: 't1',
        userId: 'u1',
        tabKind: 'composer',
        initialState: freshState(),
      },
      { now, nextId },
    );
    session = transitionSession(session, 'OPEN', now());
    session = transitionSession(session, 'HYDRATED', now());
    await sessions.insert(session);

    const r1 = applyDeltas(
      session,
      {
        tenantId: 't1',
        sessionId: session.id,
        fromIteration: 0,
        deltas: [
          { kind: 'ui.field-edit', clientIteration: 0, payload: { a: 1 } },
          { kind: 'ui.field-edit', clientIteration: 1, payload: { b: 2 } },
        ],
      },
      { now, nextId },
    );
    for (const e of r1.persistedEvents) await events.append(e);
    await sessions.replace(r1.session);

    const result = await hydrateSession(
      {
        tenantId: 't1',
        sessionId: session.id,
        clientIteration: 0,
      },
      { sessions, events, now },
    );
    expect(result.eventsApplied).toBe(2);
    expect(result.snapshotIteration).toBe(2);
  });

  it('throws when session is closed', async () => {
    const sessions = createInMemoryTabSessionRepository();
    const events = createInMemoryTabEventRepository();
    const now = () => new Date(1_700_000_000_000);
    const nextId = seq();
    let session = buildFreshTabSession(
      {
        tenantId: 't1',
        userId: 'u1',
        tabKind: 'composer',
        initialState: freshState(),
      },
      { now, nextId },
    );
    session = transitionSession(session, 'OPEN', now());
    session = transitionSession(session, 'HYDRATED', now());
    session = transitionSession(session, 'CLOSE', now());
    await sessions.insert(session);
    await expect(
      hydrateSession(
        { tenantId: 't1', sessionId: session.id, clientIteration: 0 },
        { sessions, events, now },
      ),
    ).rejects.toBeInstanceOf(HydrateError);
  });
});
