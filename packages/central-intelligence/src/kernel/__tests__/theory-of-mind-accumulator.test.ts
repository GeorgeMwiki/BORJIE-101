/**
 * Theory-of-mind stateful accumulator tests.
 *
 * The per-turn `inferMindState` already has edge-case coverage in
 * `__tests__/theory-of-mind-edges.test.ts`. This file targets the
 * new affective accumulator (frustration / comprehension / anxiety /
 * trust / urgency) + the directive-with-profile renderer.
 */

import { describe, it, expect } from 'vitest';
import {
  inferMindState,
  AFFECTIVE_DEFAULT,
  createAffectiveAccumulator,
  renderMindStateDirectiveWithProfile,
  type AffectiveStore,
  type AffectiveStoreRecord,
} from '../theory-of-mind.js';

const TTL_MS = 24 * 60 * 60 * 1000;

/**
 * In-process fake of the durable AffectiveStore. Mirrors what the DB-backed
 * store does (upsert on save, load-or-null with TTL) so the round-trip can be
 * proven without a live Postgres — the same contract the pg store honors.
 */
function fakeStore(): AffectiveStore & { rows: Map<string, AffectiveStoreRecord>; loadCalls: number } {
  const rows = new Map<string, AffectiveStoreRecord>();
  const k = (t: string, u: string) => `${t}:${u}`;
  return {
    rows,
    loadCalls: 0,
    async load(t, u) {
      this.loadCalls += 1;
      return rows.get(k(t, u)) ?? null;
    },
    async save(t, u, record) {
      rows.set(k(t, u), record);
    },
  };
}

const BASE = Date.now();
const ISO = (offset: number): string => new Date(BASE + offset).toISOString();
const AT = (offset: number): number => BASE + offset;

describe('AFFECTIVE_DEFAULT', () => {
  it('seeds frustration low and trust mid-high', () => {
    expect(AFFECTIVE_DEFAULT.frustration).toBe(0.0);
    expect(AFFECTIVE_DEFAULT.trust).toBeGreaterThan(0.5);
    expect(AFFECTIVE_DEFAULT.comprehension).toBeGreaterThan(0.5);
  });

  it('seeds all dims in [0,1]', () => {
    for (const v of Object.values(AFFECTIVE_DEFAULT)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe('createAffectiveAccumulator', () => {
  it('starts empty', () => {
    const acc = createAffectiveAccumulator();
    expect(acc.size()).toBe(0);
    expect(acc.read('t1', 'u1')).toBeNull();
  });

  it('first observation seeds the profile from default', () => {
    const acc = createAffectiveAccumulator();
    const profile = acc.observe('t1', 'u1', {
      mindState: inferMindState('hello'),
      capturedAt: ISO(1),
    });
    expect(profile.turns).toBe(1);
    // Default frustration is 0; should remain near 0 after a neutral turn.
    expect(profile.state.frustration).toBeLessThanOrEqual(0.05);
  });

  it('accumulates frustration across negative turns', () => {
    const acc = createAffectiveAccumulator();
    acc.observe('t1', 'u1', {
      mindState: inferMindState('I am furious about this'),
      capturedAt: ISO(1),
    });
    const p2 = acc.observe('t1', 'u1', {
      mindState: inferMindState('this is so frustrating!!!'),
      capturedAt: ISO(2),
    });
    expect(p2.state.frustration).toBeGreaterThan(0.2);
  });

  it('positive turns lower frustration and raise trust', () => {
    const acc = createAffectiveAccumulator();
    acc.observe('t1', 'u1', {
      mindState: inferMindState('I am furious!!!'),
      capturedAt: ISO(1),
    });
    const baseline = acc.read('t1', 'u1')!.state;
    const p2 = acc.observe('t1', 'u1', {
      mindState: inferMindState('thanks, perfect'),
      capturedAt: ISO(2),
    });
    expect(p2.state.frustration).toBeLessThan(baseline.frustration);
    expect(p2.state.trust).toBeGreaterThan(baseline.trust);
  });

  it('expert framing raises comprehension', () => {
    const acc = createAffectiveAccumulator();
    const p = acc.observe('t1', 'u1', {
      mindState: inferMindState('what is the cap rate by block'),
      capturedAt: ISO(1),
    });
    expect(p.state.comprehension).toBeGreaterThan(AFFECTIVE_DEFAULT.comprehension);
  });

  it('high-urgency raises both urgency and anxiety', () => {
    const acc = createAffectiveAccumulator();
    const p = acc.observe('t1', 'u1', {
      mindState: inferMindState('do this now!!! emergency'),
      capturedAt: ISO(1),
    });
    expect(p.state.urgency).toBeGreaterThan(AFFECTIVE_DEFAULT.urgency);
    expect(p.state.anxiety).toBeGreaterThan(AFFECTIVE_DEFAULT.anxiety);
  });

  it('prior outcome=success raises trust, lowers frustration', () => {
    const acc = createAffectiveAccumulator();
    acc.observe('t1', 'u1', {
      mindState: inferMindState('I am furious'),
      capturedAt: ISO(1),
    });
    const baseline = acc.read('t1', 'u1')!.state;
    const p2 = acc.observe('t1', 'u1', {
      mindState: inferMindState('ok'),
      capturedAt: ISO(2),
      priorOutcome: 'success',
    });
    expect(p2.state.trust).toBeGreaterThan(baseline.trust);
    expect(p2.state.frustration).toBeLessThan(baseline.frustration);
  });

  it('prior outcome=failure raises frustration, lowers trust', () => {
    const acc = createAffectiveAccumulator();
    acc.observe('t1', 'u1', {
      mindState: inferMindState('ok'),
      capturedAt: ISO(1),
    });
    const baseline = acc.read('t1', 'u1')!.state;
    const p2 = acc.observe('t1', 'u1', {
      mindState: inferMindState('ok'),
      capturedAt: ISO(2),
      priorOutcome: 'failure',
    });
    expect(p2.state.frustration).toBeGreaterThan(baseline.frustration);
    expect(p2.state.trust).toBeLessThan(baseline.trust);
  });

  it('long latency raises anxiety, drops comprehension', () => {
    const acc = createAffectiveAccumulator();
    const p = acc.observe('t1', 'u1', {
      mindState: inferMindState('ok'),
      capturedAt: ISO(1),
      priorTurnLatencyMs: 6 * 60 * 1000, // 6 min
    });
    expect(p.state.anxiety).toBeGreaterThan(AFFECTIVE_DEFAULT.anxiety);
    expect(p.state.comprehension).toBeLessThan(AFFECTIVE_DEFAULT.comprehension);
  });

  it('keeps separate state per (tenant,user)', () => {
    const acc = createAffectiveAccumulator();
    acc.observe('t1', 'alice', {
      mindState: inferMindState('I am furious'),
      capturedAt: ISO(1),
    });
    acc.observe('t1', 'bob', {
      mindState: inferMindState('thanks!'),
      capturedAt: ISO(1),
    });
    expect(acc.read('t1', 'alice')!.state.frustration).toBeGreaterThan(0.1);
    expect(acc.read('t1', 'bob')!.state.frustration).toBeLessThan(0.1);
  });

  it('TTL-evicts entries older than 24h', () => {
    const acc = createAffectiveAccumulator();
    acc.observe('t1', 'u1', {
      mindState: inferMindState('ok'),
      capturedAt: ISO(0),
    });
    const oneDayLater = AT(0) + 25 * 60 * 60 * 1000;
    expect(acc.read('t1', 'u1', oneDayLater)).toBeNull();
  });

  it('values stay clamped to [0,1] even on repeated negative turns', () => {
    const acc = createAffectiveAccumulator();
    let p = acc.read('t1', 'u1');
    for (let i = 0; i < 30; i += 1) {
      p = acc.observe('t1', 'u1', {
        mindState: inferMindState('I am furious!!!'),
        capturedAt: ISO(i + 1),
        priorOutcome: 'failure',
      });
    }
    for (const v of Object.values(p!.state)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe('renderMindStateDirectiveWithProfile', () => {
  it('falls back to base directive when no profile / few turns', () => {
    const ms = inferMindState('what is the rent');
    const directive = renderMindStateDirectiveWithProfile(ms, null);
    expect(directive).toBeTruthy();
    expect(directive).not.toMatch(/escalating frustration/);
  });

  it('adds escalating-frustration hint when state.frustration ≥ 0.5', () => {
    const ms = inferMindState('what is the rent');
    const directive = renderMindStateDirectiveWithProfile(ms, {
      state: { frustration: 0.6, comprehension: 0.7, anxiety: 0.3, trust: 0.6, urgency: 0.4 },
      turns: 4,
      updatedAt: ISO(1),
    });
    expect(directive).toMatch(/escalating frustration/);
  });

  it('adds comprehension-eroded hint when comprehension ≤ 0.4', () => {
    const ms = inferMindState('ok');
    const directive = renderMindStateDirectiveWithProfile(ms, {
      state: { frustration: 0.1, comprehension: 0.3, anxiety: 0.3, trust: 0.6, urgency: 0.4 },
      turns: 3,
      updatedAt: ISO(1),
    });
    expect(directive).toMatch(/Comprehension has eroded/);
  });

  it('adds anxiety reassurance when anxiety ≥ 0.6', () => {
    const ms = inferMindState('ok');
    const directive = renderMindStateDirectiveWithProfile(ms, {
      state: { frustration: 0.1, comprehension: 0.7, anxiety: 0.7, trust: 0.6, urgency: 0.4 },
      turns: 3,
      updatedAt: ISO(1),
    });
    expect(directive).toMatch(/Anxiety is high/);
  });

  it('adds cite-every-claim hint when trust ≤ 0.4', () => {
    const ms = inferMindState('ok');
    const directive = renderMindStateDirectiveWithProfile(ms, {
      state: { frustration: 0.1, comprehension: 0.7, anxiety: 0.3, trust: 0.3, urgency: 0.4 },
      turns: 3,
      updatedAt: ISO(1),
    });
    expect(directive).toMatch(/Trust is low/);
    expect(directive).toMatch(/cite every claim/);
  });

  it('adds sustained-urgency hint when urgency ≥ 0.7', () => {
    const ms = inferMindState('ok');
    const directive = renderMindStateDirectiveWithProfile(ms, {
      state: { frustration: 0.1, comprehension: 0.7, anxiety: 0.3, trust: 0.6, urgency: 0.8 },
      turns: 3,
      updatedAt: ISO(1),
    });
    expect(directive).toMatch(/Sustained urgency/);
  });
});

// ────────────────────────────────────────────────────────────────────
// Pluggable durable store — restart / multi-replica continuity.
// ────────────────────────────────────────────────────────────────────

describe('createAffectiveAccumulator with a durable store', () => {
  it('write-throughs each observe() to the store', async () => {
    const store = fakeStore();
    const acc = createAffectiveAccumulator({ store });
    acc.observe('t1', 'u1', {
      mindState: inferMindState('I am furious!!!'),
      capturedAt: ISO(1),
    });
    // write-through is fire-and-forget; let the microtask flush.
    await Promise.resolve();
    await Promise.resolve();
    const row = store.rows.get('t1:u1');
    expect(row).toBeDefined();
    expect(row!.turns).toBe(1);
    expect(row!.state.frustration).toBeGreaterThan(0.1);
    expect(row!.expiresAtMs).toBe(row!.updatedAtMs + TTL_MS);
  });

  it('observe()->store->hydrate() round-trips through a FRESH accumulator (restart)', async () => {
    const store = fakeStore();
    // Replica A observes a frustrated streak and writes through.
    const accA = createAffectiveAccumulator({ store });
    accA.observe('t1', 'u1', {
      mindState: inferMindState('I am furious!!!'),
      capturedAt: ISO(1),
    });
    const p1 = accA.observe('t1', 'u1', {
      mindState: inferMindState('this is so frustrating!!!'),
      capturedAt: ISO(2),
    });
    await Promise.resolve();
    await Promise.resolve();

    // Replica B (or A after restart): empty cache, hydrates from the store.
    const accB = createAffectiveAccumulator({ store });
    expect(accB.read('t1', 'u1', AT(3))).toBeNull(); // nothing cached yet
    const hydrated = await accB.hydrate('t1', 'u1', AT(3));
    expect(hydrated).not.toBeNull();
    expect(hydrated!.turns).toBe(p1.turns);
    expect(hydrated!.state.frustration).toBeCloseTo(p1.state.frustration, 3);
    // Now it is in B's cache and reads synchronously.
    expect(accB.read('t1', 'u1', AT(3))!.state.frustration).toBeCloseTo(
      p1.state.frustration,
      3,
    );
  });

  it('hydrate() honors TTL — an expired durable row reads as absent', async () => {
    const store = fakeStore();
    const acc = createAffectiveAccumulator({ store });
    acc.observe('t1', 'u1', {
      mindState: inferMindState('I am furious'),
      capturedAt: ISO(0),
    });
    await Promise.resolve();
    await Promise.resolve();

    const fresh = createAffectiveAccumulator({ store });
    const past25h = AT(0) + 25 * 60 * 60 * 1000;
    const hydrated = await fresh.hydrate('t1', 'u1', past25h);
    expect(hydrated).toBeNull();
    expect(fresh.size()).toBe(0); // nothing cached from an expired row
  });

  it('hydrate() prefers a live cache entry over a store round-trip', async () => {
    const store = fakeStore();
    const acc = createAffectiveAccumulator({ store });
    acc.observe('t1', 'u1', {
      mindState: inferMindState('ok'),
      capturedAt: ISO(1),
    });
    await Promise.resolve();
    const before = store.loadCalls;
    const hydrated = await acc.hydrate('t1', 'u1', AT(2));
    expect(hydrated).not.toBeNull();
    expect(store.loadCalls).toBe(before); // cache hit → no load call
  });

  it('degrades to in-memory when the store save() throws (turn never breaks)', () => {
    const throwingStore: AffectiveStore = {
      load: async () => {
        throw new Error('db down');
      },
      save: async () => {
        throw new Error('db down');
      },
    };
    const acc = createAffectiveAccumulator({ store: throwingStore });
    // observe() must return the computed profile synchronously despite save() throwing.
    const p = acc.observe('t1', 'u1', {
      mindState: inferMindState('I am furious!!!'),
      capturedAt: ISO(1),
    });
    expect(p.turns).toBe(1);
    expect(p.state.frustration).toBeGreaterThan(0.1);
    // in-memory read still works.
    expect(acc.read('t1', 'u1')!.state.frustration).toBeGreaterThan(0.1);
  });

  it('hydrate() degrades to cache (or null) when the store load() rejects', async () => {
    const rejectingLoad: AffectiveStore = {
      load: async () => Promise.reject(new Error('db timeout')),
      save: async () => {},
    };
    const acc = createAffectiveAccumulator({ store: rejectingLoad });
    // Nothing cached, load rejects → null, no throw.
    await expect(acc.hydrate('t1', 'u1', AT(1))).resolves.toBeNull();
  });

  it('with NO store, hydrate() is a no-op that returns the cached profile', async () => {
    const acc = createAffectiveAccumulator();
    acc.observe('t1', 'u1', {
      mindState: inferMindState('I am furious'),
      capturedAt: ISO(1),
    });
    const hydrated = await acc.hydrate('t1', 'u1', AT(2));
    expect(hydrated).not.toBeNull();
    expect(hydrated!.turns).toBe(1);
    // A cold (tenant,user) with no store and no cache → null.
    expect(await acc.hydrate('t1', 'cold', AT(2))).toBeNull();
  });

  it('the pure in-memory path still behaves identically (no store attached)', () => {
    const acc = createAffectiveAccumulator();
    acc.observe('t1', 'u1', {
      mindState: inferMindState('I am furious'),
      capturedAt: ISO(1),
    });
    expect(acc.read('t1', 'u1')!.state.frustration).toBeGreaterThan(0.1);
    expect(acc.read('t1', 'u1', AT(1) + 25 * 60 * 60 * 1000)).toBeNull();
    expect(acc.size()).toBe(0); // TTL read evicted it
  });
});
