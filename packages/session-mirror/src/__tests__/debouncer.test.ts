/**
 * debouncer.test — the timing contract behind `useFieldCapture`.
 *
 * The hook itself is a React-glue wrapper; the actual debounce logic
 * lives in this class so we can exercise it with fake timers.
 */

import { describe, expect, it, vi } from 'vitest';
import { Debouncer } from '../field-capture/debouncer.js';

describe('Debouncer', () => {
  it('fires once after the debounce window elapses', async () => {
    vi.useFakeTimers();
    const calls: string[] = [];
    const d = new Debouncer<string>({
      debounceMs: 200,
      onFire: (v) => {
        calls.push(v);
      },
    });
    d.schedule('a');
    d.schedule('b');
    d.schedule('c');
    expect(calls).toEqual([]);
    await vi.advanceTimersByTimeAsync(199);
    expect(calls).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toEqual(['c']);
    vi.useRealTimers();
  });

  it('flush() fires synchronously and clears pending', async () => {
    const calls: string[] = [];
    const d = new Debouncer<string>({
      debounceMs: 100_000,
      onFire: (v) => {
        calls.push(v);
      },
    });
    d.schedule('hello');
    expect(d.__pending()).toBe('hello');
    await d.flush();
    expect(calls).toEqual(['hello']);
    expect(d.__pending()).toBeNull();
  });

  it('cancel() drops the pending value without firing', async () => {
    const calls: string[] = [];
    const d = new Debouncer<string>({
      debounceMs: 200,
      onFire: (v) => {
        calls.push(v);
      },
    });
    d.schedule('x');
    d.cancel();
    expect(d.__pending()).toBeNull();
    await d.flush();
    expect(calls).toEqual([]);
  });

  it('swallows errors from onFire', async () => {
    const d = new Debouncer<string>({
      debounceMs: 100,
      onFire: () => {
        throw new Error('downstream');
      },
    });
    d.schedule('x');
    await expect(d.flush()).resolves.toBeUndefined();
  });
});
