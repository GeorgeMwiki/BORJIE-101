import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { yieldNow, processInChunks } from '../yield-and-chunk/index.js';

type GlobalWithWindow = typeof globalThis & {
  window?: { scheduler?: { yield?: () => Promise<void> } };
};

function clearWindow(): void {
  const g = globalThis as GlobalWithWindow;
  delete g.window;
}

describe('yieldNow', () => {
  beforeEach(() => {
    clearWindow();
  });

  afterEach(() => {
    clearWindow();
  });

  it('resolves immediately when window is undefined (SSR-safe)', async () => {
    const start = Date.now();
    await yieldNow();
    expect(Date.now() - start).toBeLessThan(5);
  });

  it('calls scheduler.yield() when available', async () => {
    const yieldFn = vi.fn().mockResolvedValue(undefined);
    (globalThis as GlobalWithWindow).window = {
      scheduler: { yield: yieldFn },
    };
    await yieldNow();
    expect(yieldFn).toHaveBeenCalledTimes(1);
  });

  it('falls back to setTimeout(0) when scheduler missing', async () => {
    (globalThis as GlobalWithWindow).window = {};
    const start = Date.now();
    await yieldNow();
    expect(Date.now() - start).toBeGreaterThanOrEqual(0);
  });

  it('falls back to setTimeout when scheduler.yield is not a function', async () => {
    (globalThis as GlobalWithWindow).window = {
      scheduler: {},
    };
    await yieldNow();
  });
});

describe('processInChunks', () => {
  beforeEach(() => {
    clearWindow();
  });

  it('returns empty array for empty input without invoking fn', async () => {
    const fn = vi.fn();
    const out = await processInChunks([], fn);
    expect(out).toEqual([]);
    expect(fn).not.toHaveBeenCalled();
  });

  it('maps items in input order', async () => {
    const items = [1, 2, 3, 4, 5];
    const out = await processInChunks(items, (n) => n * 2);
    expect(out).toEqual([2, 4, 6, 8, 10]);
  });

  it('passes the index to the callback', async () => {
    const items = ['a', 'b', 'c'];
    const out = await processInChunks(items, (item, idx) => `${idx}:${item}`);
    expect(out).toEqual(['0:a', '1:b', '2:c']);
  });

  it('awaits async callbacks', async () => {
    const items = [1, 2, 3];
    const out = await processInChunks(items, async (n) => {
      await new Promise<void>((r) => setTimeout(r, 1));
      return n * 10;
    });
    expect(out).toEqual([10, 20, 30]);
  });

  it('fires onChunk callback at chunk boundaries', async () => {
    const items = Array.from({ length: 100 }, (_, i) => i);
    const progressEvents: number[] = [];
    await processInChunks(items, (n) => n, {
      chunkSize: 25,
      onChunk: (p) => progressEvents.push(p.processed),
    });
    expect(progressEvents).toEqual([25, 50, 75]);
  });

  it('honours custom chunkSize', async () => {
    const items = Array.from({ length: 10 }, (_, i) => i);
    const progress: number[] = [];
    await processInChunks(items, (n) => n, {
      chunkSize: 3,
      onChunk: (p) => progress.push(p.processed),
    });
    expect(progress).toEqual([3, 6, 9]);
  });

  it('does not yield after the final item', async () => {
    const items = Array.from({ length: 50 }, (_, i) => i);
    const progress: number[] = [];
    await processInChunks(items, (n) => n, {
      chunkSize: 50,
      onChunk: (p) => progress.push(p.processed),
    });
    expect(progress).toEqual([]);
  });

  it('treats fractional chunkSize as floored, minimum 1', async () => {
    const items = [1, 2, 3];
    const out = await processInChunks(items, (n) => n, { chunkSize: 0.5 });
    expect(out).toEqual([1, 2, 3]);
  });

  it('propagates errors from the callback', async () => {
    const items = [1, 2, 3];
    await expect(
      processInChunks(items, (n) => {
        if (n === 2) throw new Error('boom');
        return n;
      }),
    ).rejects.toThrow('boom');
  });

  it('yieldEvery overrides chunkSize for yield cadence', async () => {
    const items = Array.from({ length: 20 }, (_, i) => i);
    const progress: number[] = [];
    await processInChunks(items, (n) => n, {
      chunkSize: 100,
      yieldEvery: 5,
      onChunk: (p) => progress.push(p.processed),
    });
    expect(progress).toEqual([5, 10, 15]);
  });
});
