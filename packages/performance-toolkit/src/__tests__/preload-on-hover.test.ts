import { describe, expect, it, vi } from 'vitest';
import {
  preloadOnHover,
  preloadManyOnHover,
} from '../lazy-load/preload-on-hover.js';

async function flushMicrotasks(): Promise<void> {
  // Resolve any pending microtasks scheduled by preload triggers.
  await new Promise((r) => setImmediate(r));
}

describe('preloadOnHover', () => {
  it('returns three handler keys for hover, focus, touch', () => {
    const handlers = preloadOnHover(() => Promise.resolve({}));
    expect(typeof handlers.onMouseEnter).toBe('function');
    expect(typeof handlers.onFocus).toBe('function');
    expect(typeof handlers.onTouchStart).toBe('function');
  });

  it('does not invoke the loader on construction', () => {
    const loader = vi.fn(() => Promise.resolve('mod'));
    preloadOnHover(loader);
    expect(loader).not.toHaveBeenCalled();
  });

  it('invokes the loader exactly once on first hover', async () => {
    const loader = vi.fn(() => Promise.resolve('mod'));
    const handlers = preloadOnHover(loader);
    handlers.onMouseEnter();
    await flushMicrotasks();
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('debounces repeated hovers — only fires once', async () => {
    const loader = vi.fn(() => Promise.resolve('mod'));
    const handlers = preloadOnHover(loader);
    handlers.onMouseEnter();
    handlers.onFocus();
    handlers.onTouchStart();
    handlers.onMouseEnter();
    await flushMicrotasks();
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('swallows loader rejection (no unhandled error)', async () => {
    const loader = vi.fn(() => Promise.reject(new Error('chunk fail')));
    const handlers = preloadOnHover(loader);
    handlers.onMouseEnter();
    await flushMicrotasks();
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('each preloadOnHover call has independent debounce state', async () => {
    const a = vi.fn(() => Promise.resolve('a'));
    const b = vi.fn(() => Promise.resolve('b'));
    const handlersA = preloadOnHover(a);
    const handlersB = preloadOnHover(b);
    handlersA.onMouseEnter();
    handlersB.onMouseEnter();
    await flushMicrotasks();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });
});

describe('preloadManyOnHover', () => {
  it('invokes every loader once on first trigger', async () => {
    const loaders = [
      vi.fn(() => Promise.resolve('a')),
      vi.fn(() => Promise.resolve('b')),
      vi.fn(() => Promise.resolve('c')),
    ];
    const handlers = preloadManyOnHover(loaders);
    handlers.onMouseEnter();
    await flushMicrotasks();
    loaders.forEach((l) => expect(l).toHaveBeenCalledTimes(1));
  });

  it('debounces — repeat triggers do not refire', async () => {
    const loaders = [vi.fn(() => Promise.resolve('a'))];
    const handlers = preloadManyOnHover(loaders);
    handlers.onMouseEnter();
    handlers.onFocus();
    handlers.onTouchStart();
    await flushMicrotasks();
    expect(loaders[0]).toHaveBeenCalledTimes(1);
  });

  it('swallows rejection in any single loader', async () => {
    const loaders = [
      vi.fn(() => Promise.reject(new Error('fail'))),
      vi.fn(() => Promise.resolve('b')),
    ];
    const handlers = preloadManyOnHover(loaders);
    handlers.onMouseEnter();
    await flushMicrotasks();
    expect(loaders[0]).toHaveBeenCalledTimes(1);
    expect(loaders[1]).toHaveBeenCalledTimes(1);
  });
});
