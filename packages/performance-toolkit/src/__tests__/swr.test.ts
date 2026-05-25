import { describe, expect, it, vi } from 'vitest';
import { staleWhileRevalidate } from '../cache/stale-while-revalidate.js';

describe('staleWhileRevalidate', () => {
  it('returns cached value within ttl without re-fetching', async () => {
    const fetchFn = vi.fn().mockResolvedValue('v1');
    const get = staleWhileRevalidate({ fetchFn, ttlMs: 1000, swrMs: 5000 });
    expect(await get()).toBe('v1');
    expect(await get()).toBe('v1');
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('returns stale + kicks off background refresh in SWR window', async () => {
    let counter = 0;
    const fetchFn = vi.fn(async () => `v${++counter}`);
    const get = staleWhileRevalidate({ fetchFn, ttlMs: 5, swrMs: 1000 });
    expect(await get()).toBe('v1');
    await new Promise((r) => setTimeout(r, 15)); // past ttl, within swr
    const swr = await get();
    expect(swr).toBe('v1'); // stale value returned
    await new Promise((r) => setTimeout(r, 20)); // give background refresh time
    expect(fetchFn.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('blocks for fresh fetch past swr window', async () => {
    let counter = 0;
    const fetchFn = vi.fn(async () => `v${++counter}`);
    const get = staleWhileRevalidate({ fetchFn, ttlMs: 5, swrMs: 10 });
    expect(await get()).toBe('v1');
    await new Promise((r) => setTimeout(r, 30));
    const fresh = await get();
    expect(fresh).toBe('v2');
  });

  it('coalesces concurrent fetches into one inflight promise', async () => {
    let resolveInner: (v: string) => void = () => {};
    const fetchFn = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveInner = resolve;
        }),
    );
    const get = staleWhileRevalidate({ fetchFn, ttlMs: 1000, swrMs: 5000 });
    const p1 = get();
    const p2 = get();
    const p3 = get();
    resolveInner('shared');
    const results = await Promise.all([p1, p2, p3]);
    expect(results).toEqual(['shared', 'shared', 'shared']);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('throws when ttlMs <= 0', () => {
    expect(() =>
      staleWhileRevalidate({ fetchFn: async () => 'x', ttlMs: 0, swrMs: 1 }),
    ).toThrow(/ttlMs/);
  });

  it('throws when swrMs < ttlMs', () => {
    expect(() =>
      staleWhileRevalidate({ fetchFn: async () => 'x', ttlMs: 100, swrMs: 50 }),
    ).toThrow(/swrMs/);
  });
});
