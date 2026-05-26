import { describe, it, expect } from 'vitest';
import {
  buildFreshTabSession,
  createInMemoryTabSessionRepository,
  transitionSession,
} from '../repositories/tab-session.js';
import { shouldExpire } from '../lifecycle/tab-lifecycle.js';
import type { TabState } from '../types.js';

function freshState(): TabState {
  return {
    recipeId: 'tab_recipe.dashboard',
    recipeVersion: 1,
    scopeId: null,
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

describe('expiry', () => {
  it('listExpiring returns paused sessions past their TTL', async () => {
    const sessions = createInMemoryTabSessionRepository();
    let n = 0;
    const nextId = () => `id-${(n += 1)}`;
    const t0 = new Date(1_700_000_000_000);
    // Open a session with a 60-second TTL.
    let s = buildFreshTabSession(
      {
        tenantId: 't1',
        userId: 'u1',
        tabKind: 'dashboard',
        initialState: freshState(),
        ttlMs: 60_000,
      },
      { now: () => t0, nextId },
    );
    s = transitionSession(s, 'OPEN', t0);
    s = transitionSession(s, 'HYDRATED', t0);
    const pauseTime = new Date(t0.getTime() + 1_000);
    s = transitionSession(s, 'BLUR', pauseTime);
    await sessions.insert(s);

    // Within TTL — not expiring.
    const within = await sessions.listExpiring(
      new Date(t0.getTime() + 30_000),
    );
    expect(within.length).toBe(0);

    // Past TTL — yes.
    const past = await sessions.listExpiring(new Date(t0.getTime() + 70_000));
    expect(past.length).toBe(1);
    expect(past[0]?.id).toBe(s.id);
  });

  it('shouldExpire matches listExpiring predicate exactly', async () => {
    const t0 = new Date(1_700_000_000_000);
    const expiresAt = new Date(t0.getTime() + 60_000);
    expect(shouldExpire('paused', t0, expiresAt, new Date(t0.getTime() + 30_000))).toBe(false);
    expect(shouldExpire('paused', t0, expiresAt, new Date(t0.getTime() + 70_000))).toBe(true);
    expect(shouldExpire('active', t0, expiresAt, new Date(t0.getTime() + 70_000))).toBe(false);
  });

  it('audit chain links session to its transitions (forward prev_hash)', async () => {
    let n = 0;
    const nextId = () => `id-${(n += 1)}`;
    const t0 = new Date(1_700_000_000_000);
    const s = buildFreshTabSession(
      {
        tenantId: 't1',
        userId: 'u1',
        tabKind: 'composer',
        initialState: freshState(),
      },
      { now: () => t0, nextId },
    );
    const opened = transitionSession(s, 'OPEN', t0);
    const hydrated = transitionSession(opened, 'HYDRATED', t0);
    expect(opened.prevHash).toBe(s.auditHash);
    expect(hydrated.prevHash).toBe(opened.auditHash);
    expect(opened.auditHash).not.toBe(s.auditHash);
    expect(hydrated.auditHash).not.toBe(opened.auditHash);
  });
});
