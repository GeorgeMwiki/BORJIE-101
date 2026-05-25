/**
 * In-memory cache-store + cosine-similarity coverage.
 *
 * Mirrors the brain-cache test pattern (insertion-ordered LRU, ttl
 * eviction, scope isolation).
 */

import { describe, it, expect } from 'vitest';
import {
  cosineSimilarity,
  createInMemoryCacheStore,
  createRedisCacheStore,
  scopeKey,
  type SemanticCacheScope,
} from '../cache-store.js';
import type { BrainDecision } from '../../kernel-types.js';

function fakeDecision(text: string): BrainDecision {
  return {
    kind: 'answer',
    text,
    citations: [],
    artifacts: [],
    confidence: {
      groundedness: 1,
      stability: 1,
      review: 1,
      numericalConsistency: 1,
      overall: 1,
    },
  } as unknown as BrainDecision;
}

const SCOPE_A: SemanticCacheScope = {
  tenantId: 'tenant-A',
  surface: 'tenant-portal',
  personaId: 'tenant-resident',
};
const SCOPE_B: SemanticCacheScope = {
  tenantId: 'tenant-B',
  surface: 'tenant-portal',
  personaId: 'tenant-resident',
};

function vec(values: number[], dims = 16): number[] {
  const out = new Array(dims).fill(0);
  values.forEach((v, i) => {
    if (i < dims) out[i] = v;
  });
  return out;
}

describe('cosineSimilarity', () => {
  it('returns 1.0 for identical vectors', () => {
    const v = vec([1, 0, 1, 0, 1]);
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0, 6);
  });

  it('returns 1.0 for scaled-identical vectors', () => {
    const a = vec([1, 2, 3, 4]);
    const b = vec([2, 4, 6, 8]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(1.0, 6);
  });

  it('returns ~0 for orthogonal vectors', () => {
    const a = vec([1, 0, 0, 0]);
    const b = vec([0, 1, 0, 0]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(0, 6);
  });

  it('returns ~-1 for inverted vectors', () => {
    const a = vec([1, 2, 3]);
    const b = vec([-1, -2, -3]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1.0, 6);
  });

  it('returns 0 for empty vectors', () => {
    expect(cosineSimilarity([], [])).toBe(0);
  });

  it('returns 0 for length-mismatched vectors', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2])).toBe(0);
  });

  it('returns 0 when one vector is zero-norm', () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
  });

  it('returns a value >= 0.95 for vectors with one perturbed component', () => {
    const dims = 1536;
    const a = new Array(dims).fill(0).map((_, i) => Math.sin(i));
    const b = a.slice();
    b[0] = (b[0] ?? 0) + 0.001;
    expect(cosineSimilarity(a, b)).toBeGreaterThanOrEqual(0.95);
  });
});

describe('scopeKey', () => {
  it('preserves tenant + surface + persona triple', () => {
    expect(scopeKey(SCOPE_A)).toBe('tenant-A|tenant-portal|tenant-resident');
  });
  it('falls back to __platform__ for null tenantId', () => {
    expect(
      scopeKey({
        tenantId: null,
        surface: 'sovereign-cockpit',
        personaId: 'sovereign-admin',
      }),
    ).toBe('__platform__|sovereign-cockpit|sovereign-admin');
  });
});

describe('createInMemoryCacheStore', () => {
  it('stores and retrieves an entry above threshold', async () => {
    const store = createInMemoryCacheStore({ capacityPerScope: 16 });
    const e = vec([1, 0, 0]);
    await store.set(SCOPE_A, {
      cacheId: 'c1',
      embedding: e,
      value: fakeDecision('hello'),
      ttlMs: 60_000,
    });
    const hit = await store.get(SCOPE_A, e, 0.95);
    expect(hit).not.toBeNull();
    expect(hit?.entry.cacheId).toBe('c1');
    expect(hit?.similarity).toBeCloseTo(1.0, 6);
  });

  it('returns null when no entry meets threshold', async () => {
    const store = createInMemoryCacheStore();
    await store.set(SCOPE_A, {
      cacheId: 'c1',
      embedding: vec([1, 0, 0]),
      value: fakeDecision('hello'),
      ttlMs: 60_000,
    });
    const hit = await store.get(SCOPE_A, vec([0, 1, 0]), 0.95);
    expect(hit).toBeNull();
  });

  it('isolates entries across scopes (tenant A vs tenant B)', async () => {
    const store = createInMemoryCacheStore();
    const e = vec([1, 0, 0]);
    await store.set(SCOPE_A, {
      cacheId: 'c1',
      embedding: e,
      value: fakeDecision('A says hi'),
      ttlMs: 60_000,
    });
    const hit = await store.get(SCOPE_B, e, 0.95);
    expect(hit).toBeNull();
    expect(await store.size(SCOPE_A)).toBe(1);
    expect(await store.size(SCOPE_B)).toBe(0);
  });

  it('respects ttl — expired entry returns null', async () => {
    let now = 1_000;
    const store = createInMemoryCacheStore({ clock: () => now });
    await store.set(SCOPE_A, {
      cacheId: 'c1',
      embedding: vec([1, 0]),
      value: fakeDecision('x'),
      ttlMs: 500,
    });
    expect(await store.get(SCOPE_A, vec([1, 0]), 0.95)).not.toBeNull();
    now = 2_000; // past expiry
    expect(await store.get(SCOPE_A, vec([1, 0]), 0.95)).toBeNull();
  });

  it('ttlMs <= 0 does not persist (command-intent contract)', async () => {
    const store = createInMemoryCacheStore();
    await store.set(SCOPE_A, {
      cacheId: 'c1',
      embedding: vec([1, 0]),
      value: fakeDecision('x'),
      ttlMs: 0,
    });
    expect(await store.size(SCOPE_A)).toBe(0);
  });

  it('LRU eviction kicks in past capacity', async () => {
    const capacity = 5;
    const dims = 16;
    const store = createInMemoryCacheStore({ capacityPerScope: capacity });
    // Use ORTHOGONAL one-hot vectors so each entry has a distinct
    // identity and `get()` only matches its exact key.
    for (let i = 0; i < capacity + 1; i += 1) {
      const e = new Array(dims).fill(0);
      e[i] = 1;
      await store.set(SCOPE_A, {
        cacheId: `c${i}`,
        embedding: e,
        value: fakeDecision(`v${i}`),
        ttlMs: 60_000,
      });
    }
    expect(await store.size(SCOPE_A)).toBe(capacity);
    // The oldest (c0) should be evicted — query for its slot vector.
    const probe = new Array(dims).fill(0);
    probe[0] = 1;
    const hit = await store.get(SCOPE_A, probe, 0.95);
    expect(hit).toBeNull();
  });

  it('LRU touch on hit refreshes order', async () => {
    const store = createInMemoryCacheStore({ capacityPerScope: 3 });
    const dims = 16;
    const oneHot = (i: number): number[] => {
      const e = new Array(dims).fill(0);
      e[i] = 1;
      return e;
    };
    for (let i = 0; i < 3; i += 1) {
      await store.set(SCOPE_A, {
        cacheId: `c${i}`,
        embedding: oneHot(i),
        value: fakeDecision(`v${i}`),
        ttlMs: 60_000,
      });
    }
    // Touch c0 — should refresh to tail.
    await store.get(SCOPE_A, oneHot(0), 0.95);
    // Insert c3 — c1 should now be the oldest victim, c0 survives.
    await store.set(SCOPE_A, {
      cacheId: 'c3',
      embedding: oneHot(3),
      value: fakeDecision('v3'),
      ttlMs: 60_000,
    });
    const c0 = await store.get(SCOPE_A, oneHot(0), 0.95);
    expect(c0).not.toBeNull();
    expect(c0?.entry.cacheId).toBe('c0');
    const c1 = await store.get(SCOPE_A, oneHot(1), 0.95);
    expect(c1).toBeNull();
  });

  it('clear() drops every entry under a scope', async () => {
    const store = createInMemoryCacheStore();
    await store.set(SCOPE_A, {
      cacheId: 'c1',
      embedding: vec([1, 0]),
      value: fakeDecision('x'),
      ttlMs: 60_000,
    });
    await store.set(SCOPE_B, {
      cacheId: 'c1',
      embedding: vec([1, 0]),
      value: fakeDecision('x'),
      ttlMs: 60_000,
    });
    await store.clear(SCOPE_A);
    expect(await store.size(SCOPE_A)).toBe(0);
    expect(await store.size(SCOPE_B)).toBe(1);
  });

  it('chooses highest-similarity entry when multiple match', async () => {
    const store = createInMemoryCacheStore();
    const dims = 64;
    const a = new Array(dims).fill(0);
    a[0] = 1;
    const b = new Array(dims).fill(0);
    b[0] = 0.99;
    b[1] = 0.01;
    const query = new Array(dims).fill(0);
    query[0] = 1;
    await store.set(SCOPE_A, {
      cacheId: 'close',
      embedding: b,
      value: fakeDecision('close'),
      ttlMs: 60_000,
    });
    await store.set(SCOPE_A, {
      cacheId: 'exact',
      embedding: a,
      value: fakeDecision('exact'),
      ttlMs: 60_000,
    });
    const hit = await store.get(SCOPE_A, query, 0.9);
    expect(hit?.entry.cacheId).toBe('exact');
  });

  it('clearAll() wipes every scope', async () => {
    const store = createInMemoryCacheStore();
    await store.set(SCOPE_A, {
      cacheId: 'c1',
      embedding: vec([1, 0]),
      value: fakeDecision('x'),
      ttlMs: 60_000,
    });
    await store.set(SCOPE_B, {
      cacheId: 'c1',
      embedding: vec([1, 0]),
      value: fakeDecision('x'),
      ttlMs: 60_000,
    });
    await store.clearAll();
    expect(await store.size(SCOPE_A)).toBe(0);
    expect(await store.size(SCOPE_B)).toBe(0);
  });

  it('refresh-on-write updates the embedding + value for the same cacheId', async () => {
    const store = createInMemoryCacheStore();
    await store.set(SCOPE_A, {
      cacheId: 'c1',
      embedding: vec([1, 0]),
      value: fakeDecision('first'),
      ttlMs: 60_000,
    });
    await store.set(SCOPE_A, {
      cacheId: 'c1',
      embedding: vec([0, 1]),
      value: fakeDecision('second'),
      ttlMs: 60_000,
    });
    const hit = await store.get(SCOPE_A, vec([0, 1]), 0.95);
    expect(hit?.entry.value.kind === 'answer' && hit.entry.value.text).toBe(
      'second',
    );
  });
});

describe('createRedisCacheStore (deferred adapter)', () => {
  it('falls back to in-memory when no redis client supplied', async () => {
    const warns: string[] = [];
    const store = createRedisCacheStore({
      logger: { warn: (m) => warns.push(m) },
    });
    await store.set(SCOPE_A, {
      cacheId: 'c1',
      embedding: vec([1, 0]),
      value: fakeDecision('x'),
      ttlMs: 60_000,
    });
    const hit = await store.get(SCOPE_A, vec([1, 0]), 0.95);
    expect(hit).not.toBeNull();
    expect(warns.length).toBeGreaterThan(0);
    expect(warns[0]).toContain('semantic-cache');
  });
});
