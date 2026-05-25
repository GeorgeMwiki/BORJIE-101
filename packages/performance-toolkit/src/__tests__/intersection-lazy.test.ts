import { describe, expect, it } from 'vitest';
import { createIntersectionLazy } from '../lazy-load/use-intersection-lazy.js';

describe('createIntersectionLazy — SSR fallback', () => {
  it('immediately loads when IntersectionObserver is not available', async () => {
    // No globalThis.IntersectionObserver in Node — degrades to immediate load.
    const ctl = createIntersectionLazy({
      loader: async () => ({ msg: 'loaded' }),
    });
    // Wait microtask
    await new Promise((r) => setTimeout(r, 5));
    const state = ctl.getState();
    expect(state.loaded).toBe(true);
    expect(state.data).toEqual({ msg: 'loaded' });
  });

  it('captures load errors as state.error', async () => {
    const ctl = createIntersectionLazy({
      loader: async () => {
        throw new Error('boom');
      },
    });
    await new Promise((r) => setTimeout(r, 5));
    const state = ctl.getState();
    expect(state.loaded).toBe(false);
    expect(state.error).toBeInstanceOf(Error);
    expect(state.error?.message).toBe('boom');
  });

  it('notifies onStateChange after successful load', async () => {
    const events: unknown[] = [];
    const ctl = createIntersectionLazy({
      loader: async () => 'data',
      onStateChange: (s) => events.push(s),
    });
    await new Promise((r) => setTimeout(r, 5));
    expect(events).toHaveLength(1);
    expect((events[0] as { loaded: boolean }).loaded).toBe(true);
    ctl.disconnect();
  });
});

describe('createIntersectionLazy — DOM path (mocked IntersectionObserver)', () => {
  it('triggers loader when entry becomes intersecting', async () => {
    type IOCallback = (entries: IntersectionObserverEntry[]) => void;
    let registeredCallback: IOCallback | null = null;
    class MockIO {
      constructor(cb: IOCallback) {
        registeredCallback = cb;
      }
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    (globalThis as unknown as { IntersectionObserver?: unknown }).IntersectionObserver =
      MockIO;

    try {
      let loadCount = 0;
      const ctl = createIntersectionLazy({
        loader: async () => {
          loadCount++;
          return 'data';
        },
      });
      const el = {} as Element;
      ctl.observe(el);
      // simulate intersection
      registeredCallback!([{ isIntersecting: true } as IntersectionObserverEntry]);
      await new Promise((r) => setTimeout(r, 5));
      expect(loadCount).toBe(1);
      expect(ctl.getState().loaded).toBe(true);
    } finally {
      (globalThis as unknown as { IntersectionObserver?: unknown }).IntersectionObserver = undefined;
    }
  });
});
