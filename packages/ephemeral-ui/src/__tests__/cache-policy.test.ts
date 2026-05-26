import { describe, expect, it } from 'vitest';
import {
  computeExpiresAt,
  createComposeCache,
  isExpired,
} from '../lifecycle/cache-policy.js';
import type { ComposeCacheEntry, ComposeCacheKey } from '../types.js';

function key(suffix: string): ComposeCacheKey {
  return {
    function_id: `fn-${suffix}`,
    manifest_version: 1,
    function_input_hash: `in-${suffix}`,
    user_context_hash: `ctx-${suffix}`,
    brand_tokens_version: 'v3',
  };
}

function entry(now: number, ttl_seconds: number): ComposeCacheEntry {
  return {
    recipe_hash: 'h',
    archetype: 'list_with_filters',
    cached_at: now,
    expires_at: computeExpiresAt(now, ttl_seconds),
  };
}

describe('cache-policy', () => {
  it('computeExpiresAt returns cached_at on ttl_seconds = 0', () => {
    expect(computeExpiresAt(1000, 0)).toBe(1000);
  });

  it('computeExpiresAt adds milliseconds when ttl > 0', () => {
    expect(computeExpiresAt(1000, 5)).toBe(1000 + 5000);
  });

  it('put then get returns the entry within TTL', () => {
    let nowMs = 1000;
    const cache = createComposeCache({ nowMs: () => nowMs });
    cache.put(key('a'), entry(nowMs, 300));
    nowMs += 200_000; // 200s later
    const got = cache.get(key('a'));
    expect(got).not.toBeNull();
  });

  it('expires after the TTL', () => {
    let nowMs = 1000;
    const cache = createComposeCache({ nowMs: () => nowMs });
    cache.put(key('a'), entry(nowMs, 5));
    nowMs += 10_000;
    expect(cache.get(key('a'))).toBeNull();
  });

  it('isExpired is true at the exact expires_at moment', () => {
    const e = entry(1000, 5);
    expect(isExpired(e, e.expires_at)).toBe(true);
  });

  it('LRU eviction kicks in when capacity is exceeded', () => {
    let nowMs = 1000;
    const cache = createComposeCache({ capacity: 2, nowMs: () => nowMs });
    cache.put(key('a'), entry(nowMs, 100));
    cache.put(key('b'), entry(nowMs, 100));
    cache.put(key('c'), entry(nowMs, 100));
    // capacity is 2; size should be 2.
    expect(cache.size()).toBeLessThanOrEqual(2);
  });

  it('LRU bumps an entry on get', () => {
    let nowMs = 1000;
    const cache = createComposeCache({ capacity: 2, nowMs: () => nowMs });
    cache.put(key('a'), entry(nowMs, 100));
    cache.put(key('b'), entry(nowMs, 100));
    // Touch 'a', then insert 'c'. 'b' should be the one evicted.
    cache.get(key('a'));
    cache.put(key('c'), entry(nowMs, 100));
    expect(cache.get(key('a'))).not.toBeNull();
    expect(cache.get(key('b'))).toBeNull();
    expect(cache.get(key('c'))).not.toBeNull();
  });

  it('clear empties the cache', () => {
    const cache = createComposeCache();
    cache.put(key('x'), entry(0, 100));
    expect(cache.size()).toBe(1);
    cache.clear();
    expect(cache.size()).toBe(0);
  });
});
