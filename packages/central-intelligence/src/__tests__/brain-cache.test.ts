/**
 * Brain cache — unit tests for createBrainCache + thoughtCacheKey.
 *
 * Covers:
 *   - get/set/size/clear basic behaviour
 *   - TTL expiration on read
 *   - LRU eviction at capacity
 *   - delete()
 *   - thoughtCacheKey distinguishes by user, message, scope kind, tier, surface, stakes
 */

import { describe, it, expect } from 'vitest';
import {
  createBrainCache,
  thoughtCacheKey,
  type BrainDecision,
  type ThoughtRequest,
} from '../kernel/index.js';
import type { ScopeContext } from '../types.js';

const TENANT: ScopeContext = {
  kind: 'tenant',
  tenantId: 't_1',
  actorUserId: 'u_alice',
  roles: ['estate-manager'],
  personaId: 'estate-manager',
};

function decision(text: string): BrainDecision {
  // Minimal `answer` shape; cast covers fields the cache never inspects
  // (`gates`, `provenance`) — the cache treats values as opaque.
  return {
    kind: 'answer',
    text,
    citations: [],
    artifacts: [],
    confidence: { groundedness: 1, stability: 1, review: 1, numericalConsistency: 1, overall: 1 },
  } as unknown as BrainDecision;
}

function req(over: Partial<ThoughtRequest> = {}): ThoughtRequest {
  return {
    threadId: 'th',
    userMessage: 'how is collection?',
    scope: TENANT,
    tier: 'property',
    stakes: 'low',
    surface: 'estate-manager-app',
    ...over,
  };
}

describe('createBrainCache', () => {
  it('returns null for missing keys', () => {
    const c = createBrainCache();
    expect(c.get('missing')).toBeNull();
  });

  it('round-trips set/get', () => {
    const c = createBrainCache();
    const v = decision('answer-1');
    c.set('k1', v);
    expect(c.get('k1')).toBe(v);
    expect(c.size()).toBe(1);
  });

  it('expires entries past their TTL', () => {
    let now = 0;
    const c = createBrainCache({ ttlMs: 100, clock: () => now });
    c.set('k', decision('x'));
    now = 200;
    expect(c.get('k')).toBeNull();
    expect(c.size()).toBe(0); // expired entry pruned on read
  });

  it('respects capacity by evicting LRU entries', () => {
    const c = createBrainCache({ capacity: 3, ttlMs: 60_000 });
    c.set('a', decision('A'));
    c.set('b', decision('B'));
    c.set('c', decision('C'));
    c.set('d', decision('D')); // evicts 'a' (oldest)
    expect(c.get('a')).toBeNull();
    expect(c.get('d')?.kind).toBe('answer');
    expect(c.size()).toBe(3);
  });

  it('LRU touch on get keeps recently-used entries', () => {
    const c = createBrainCache({ capacity: 3, ttlMs: 60_000 });
    c.set('a', decision('A'));
    c.set('b', decision('B'));
    c.set('c', decision('C'));
    c.get('a');                  // touches a so b is now oldest
    c.set('d', decision('D'));   // evicts b
    expect(c.get('a')).not.toBeNull();
    expect(c.get('b')).toBeNull();
  });

  it('delete() removes entries explicitly', () => {
    const c = createBrainCache();
    c.set('k', decision('x'));
    c.delete('k');
    expect(c.get('k')).toBeNull();
    expect(c.size()).toBe(0);
  });

  it('clear() empties the cache', () => {
    const c = createBrainCache();
    c.set('k1', decision('x'));
    c.set('k2', decision('y'));
    c.clear();
    expect(c.size()).toBe(0);
  });

  it('exposes capacity and ttlMs', () => {
    const c = createBrainCache({ capacity: 17, ttlMs: 999 });
    expect(c.capacity).toBe(17);
    expect(c.ttlMs).toBe(999);
  });
});

describe('thoughtCacheKey', () => {
  it('produces equal keys for equal requests', () => {
    expect(thoughtCacheKey(req())).toBe(thoughtCacheKey(req()));
  });

  it('differs on userMessage', () => {
    expect(thoughtCacheKey(req({ userMessage: 'a' }))).not.toBe(
      thoughtCacheKey(req({ userMessage: 'b' })),
    );
  });

  it('differs on actorUserId — no cross-user bleed in same tenant', () => {
    const a = thoughtCacheKey(req({
      scope: { ...TENANT, actorUserId: 'u_alice' },
    }));
    const b = thoughtCacheKey(req({
      scope: { ...TENANT, actorUserId: 'u_bob' },
    }));
    expect(a).not.toBe(b);
  });

  it('differs on tier', () => {
    expect(thoughtCacheKey(req({ tier: 'property' }))).not.toBe(
      thoughtCacheKey(req({ tier: 'org' })),
    );
  });

  it('differs on stakes', () => {
    expect(thoughtCacheKey(req({ stakes: 'low' }))).not.toBe(
      thoughtCacheKey(req({ stakes: 'high' })),
    );
  });

  it('differs on surface', () => {
    expect(thoughtCacheKey(req({ surface: 'tenant-app' }))).not.toBe(
      thoughtCacheKey(req({ surface: 'estate-manager-app' })),
    );
  });

  it('platform scope produces a stable platform-marker key shape', () => {
    const platform: ScopeContext = {
      kind: 'platform',
      actorUserId: 'u_hq',
      roles: ['platform-admin'],
      personaId: 'platform-sovereign',
    };
    const k = thoughtCacheKey(req({
      scope: platform,
      tier: 'industry',
      surface: 'platform-hq',
    }));
    expect(typeof k).toBe('string');
    expect(k).toHaveLength(32);
  });

  it('trims whitespace on user message before hashing', () => {
    expect(thoughtCacheKey(req({ userMessage: '  hello  ' }))).toBe(
      thoughtCacheKey(req({ userMessage: 'hello' })),
    );
  });
});
