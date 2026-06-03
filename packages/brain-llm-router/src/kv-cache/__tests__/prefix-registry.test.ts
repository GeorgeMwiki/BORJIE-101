import { afterEach, describe, expect, it } from 'vitest';
import { KvPrefixRegistry, prefixKey, isKvCacheHotSwapEnabled } from '../index.js';

afterEach(() => {
  delete process.env.BORJIE_KV_CACHE_HOT_SWAP;
});

describe('prefixKey', () => {
  it('is stable + collision-resistant for distinct (model, prompt) pairs', () => {
    const a = prefixKey({ modelId: 'opus', systemPrompt: 'You are Mr. Mwikila.' });
    const b = prefixKey({ modelId: 'opus', systemPrompt: 'You are Mr. Mwikila.' });
    const c = prefixKey({ modelId: 'sonnet', systemPrompt: 'You are Mr. Mwikila.' });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('treats any prompt change as a new key (no whitespace normalisation)', () => {
    const a = prefixKey({ modelId: 'opus', systemPrompt: 'hello world' });
    const b = prefixKey({ modelId: 'opus', systemPrompt: 'hello  world' });
    expect(a).not.toBe(b);
  });
});

describe('KvPrefixRegistry (scaffold)', () => {
  it('misses then hits after assignment', () => {
    const reg = new KvPrefixRegistry();
    const args = { modelId: 'opus', systemPrompt: 'SYS' };
    expect(reg.lookup(args).outcome).toBe('miss');
    reg.assign({ ...args, cacheId: 'cache-1', tenantId: 't1' });
    const hit = reg.lookup(args);
    expect(hit.outcome).toBe('hit');
    expect(hit.entry?.cacheId).toBe('cache-1');
    expect(hit.entry?.tenantId).toBe('t1');
  });

  it('counts hits on the entry', () => {
    const reg = new KvPrefixRegistry();
    const args = { modelId: 'opus', systemPrompt: 'SYS' };
    reg.assign({ ...args, cacheId: 'c' });
    reg.lookup(args);
    reg.lookup(args);
    expect(reg.stats().totalHits).toBe(2);
  });

  it('returns the existing entry on re-assign (idempotent cache id)', () => {
    const reg = new KvPrefixRegistry();
    const args = { modelId: 'opus', systemPrompt: 'SYS' };
    const first = reg.assign({ ...args, cacheId: 'c1' });
    const second = reg.assign({ ...args, cacheId: 'c2' });
    expect(second.cacheId).toBe('c1'); // first write wins; entry reused
    expect(reg.stats().entries).toBe(1);
    expect(first.key).toBe(second.key);
  });

  it('evicts the least-recently-used entry past maxEntries', () => {
    let t = 0;
    const reg = new KvPrefixRegistry({ maxEntries: 2, now: () => (t += 1) });
    reg.assign({ modelId: 'm', systemPrompt: 'A', cacheId: 'a' }); // t=1
    reg.assign({ modelId: 'm', systemPrompt: 'B', cacheId: 'b' }); // t=2
    reg.lookup({ modelId: 'm', systemPrompt: 'A' }); // refresh A (t=3)
    reg.assign({ modelId: 'm', systemPrompt: 'C', cacheId: 'c' }); // t=4 → evict LRU (B)
    expect(reg.lookup({ modelId: 'm', systemPrompt: 'B' }).outcome).toBe('miss');
    expect(reg.lookup({ modelId: 'm', systemPrompt: 'A' }).outcome).toBe('hit');
    expect(reg.stats().evictions).toBe(1);
  });

  it('reset clears entries + eviction count', () => {
    const reg = new KvPrefixRegistry();
    reg.assign({ modelId: 'm', systemPrompt: 'A', cacheId: 'a' });
    reg.reset();
    expect(reg.stats().entries).toBe(0);
    expect(reg.lookup({ modelId: 'm', systemPrompt: 'A' }).outcome).toBe('miss');
  });

  it('is on by default and disabled only by the explicit "0" flag', () => {
    expect(isKvCacheHotSwapEnabled()).toBe(true);
    process.env.BORJIE_KV_CACHE_HOT_SWAP = '0';
    expect(isKvCacheHotSwapEnabled()).toBe(false);
  });
});
