/**
 * Tests for `cache.ts` — L1 TTL store with deterministic time hook.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cache } from '../cache.js';

describe('dynamic-registry/cache', () => {
  beforeEach(() => {
    cache.clear();
    cache.clearNowFn();
    cache.resetDefaultTtlCache();
  });

  afterEach(() => {
    cache.clear();
    cache.clearNowFn();
    cache.resetDefaultTtlCache();
  });

  it('returns null for unknown family', () => {
    expect(cache.get('opus')).toBeNull();
  });

  it('returns stored value while TTL is live', () => {
    let now = 1_000_000;
    cache.setNowFn(() => now);
    cache.set('opus', 'claude-opus-4-8', 60_000);
    expect(cache.get('opus')).toBe('claude-opus-4-8');
    now += 30_000; // half-TTL
    expect(cache.get('opus')).toBe('claude-opus-4-8');
  });

  it('returns null once TTL has elapsed', () => {
    let now = 1_000_000;
    cache.setNowFn(() => now);
    cache.set('opus', 'claude-opus-4-8', 60_000);
    now += 60_001;
    expect(cache.get('opus')).toBeNull();
  });

  it('evicts the expired entry on read', () => {
    let now = 1_000_000;
    cache.setNowFn(() => now);
    cache.set('opus', 'claude-opus-4-8', 60_000);
    expect(cache.size()).toBe(1);
    now += 100_000;
    cache.get('opus');
    expect(cache.size()).toBe(0);
  });

  it('overwrites prior value', () => {
    cache.set('opus', 'claude-opus-4-7', 60_000);
    cache.set('opus', 'claude-opus-4-8', 60_000);
    expect(cache.get('opus')).toBe('claude-opus-4-8');
  });

  it('clear wipes all entries', () => {
    cache.set('opus', 'a', 60_000);
    cache.set('sonnet', 'b', 60_000);
    cache.clear();
    expect(cache.get('opus')).toBeNull();
    expect(cache.get('sonnet')).toBeNull();
    expect(cache.size()).toBe(0);
  });

  it('falls back to default TTL when ttlMs omitted', () => {
    process.env.BORJIE_MODEL_CACHE_TTL_MS = '500';
    cache.resetDefaultTtlCache();
    let now = 1_000_000;
    cache.setNowFn(() => now);
    cache.set('opus', 'claude-opus-4-8');
    now += 499;
    expect(cache.get('opus')).toBe('claude-opus-4-8');
    now += 2;
    expect(cache.get('opus')).toBeNull();
    delete process.env.BORJIE_MODEL_CACHE_TTL_MS;
    cache.resetDefaultTtlCache();
  });

  it('rejects non-positive env TTL and uses 1h fallback', () => {
    process.env.BORJIE_MODEL_CACHE_TTL_MS = '-1';
    cache.resetDefaultTtlCache();
    let now = 1_000_000;
    cache.setNowFn(() => now);
    cache.set('opus', 'x');
    now += 59 * 60 * 1000; // 59 min
    expect(cache.get('opus')).toBe('x');
    now += 2 * 60 * 1000; // total > 1h
    expect(cache.get('opus')).toBeNull();
    delete process.env.BORJIE_MODEL_CACHE_TTL_MS;
    cache.resetDefaultTtlCache();
  });
});
