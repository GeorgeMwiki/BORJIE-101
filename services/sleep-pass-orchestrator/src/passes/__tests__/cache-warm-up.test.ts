import { describe, expect, it } from 'vitest';
import {
  createCacheWarmUpPass,
  createInMemoryCacheAdapter,
} from '../index.js';

const now = () => new Date('2026-05-25T10:00:00.000Z');
const signal = new AbortController().signal;

describe('cache-warm-up pass', () => {
  it('prewarms each entry', async () => {
    const cache = createInMemoryCacheAdapter();
    const pass = createCacheWarmUpPass(cache, [
      { key: 'top-tenants', async compute() { return [1, 2, 3]; } },
      { key: 'recent-maintenance', async compute() { return { n: 5 }; } },
    ]);
    const result = await pass.run({ abortSignal: signal, now });
    expect(result.itemsEmitted).toBe(2);
    expect(cache.warmedKeys()).toEqual(['top-tenants', 'recent-maintenance']);
  });

  it('skips failed compute without aborting the pass', async () => {
    const cache = createInMemoryCacheAdapter();
    const pass = createCacheWarmUpPass(cache, [
      { key: 'ok', async compute() { return 1; } },
      { key: 'fail', async compute() { throw new Error('bad'); } },
      { key: 'ok2', async compute() { return 2; } },
    ]);
    const result = await pass.run({ abortSignal: signal, now });
    expect(result.itemsEmitted).toBe(2);
    expect(cache.warmedKeys()).toContain('ok');
    expect(cache.warmedKeys()).toContain('ok2');
  });

  it('returns zero when no entries', async () => {
    const cache = createInMemoryCacheAdapter();
    const pass = createCacheWarmUpPass(cache, []);
    const result = await pass.run({ abortSignal: signal, now });
    expect(result.itemsProcessed).toBe(0);
    expect(result.itemsEmitted).toBe(0);
  });
});
