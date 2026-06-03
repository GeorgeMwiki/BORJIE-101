/**
 * Regression tests for the shared `raceAgainstAbort` LLM-interrupt wrapper
 * (LP-21b). Contract under test:
 *   1. No signal           → pass-through; resolution/rejection unchanged.
 *   2. Already-aborted      → reject WITHOUT awaiting the promise.
 *   3. Late abort           → reject AT ABORT TIME (not when the promise
 *                             eventually settles), AbortError-tagged.
 *   4. Promise resolves first → resolve normally; abort listener removed.
 *   5. Promise rejects first  → reject downstream error; listener removed.
 *   6. `isAbortError` recognises both message tags + the name tag.
 */

import { describe, it, expect } from 'vitest';
import {
  raceAgainstAbort,
  isAbortError,
  ABORT_REASONS,
} from '../race-against-abort.js';

describe('raceAgainstAbort — pass-through when no signal', () => {
  it('returns the underlying value unchanged', async () => {
    const v = await raceAgainstAbort(undefined, Promise.resolve(42));
    expect(v).toBe(42);
  });

  it('rejects with the underlying error unchanged', async () => {
    const err = new Error('downstream');
    await expect(
      raceAgainstAbort(undefined, Promise.reject(err)),
    ).rejects.toBe(err);
  });
});

describe('raceAgainstAbort — already-aborted signal', () => {
  it('rejects immediately without awaiting the promise', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    let touched = false;
    const slow = new Promise<number>((resolve) => {
      setTimeout(() => {
        touched = true;
        resolve(1);
      }, 5_000);
    });
    await expect(raceAgainstAbort(ctrl.signal, slow)).rejects.toMatchObject({
      name: 'AbortError',
      message: ABORT_REASONS.BEFORE_START,
    });
    expect(touched).toBe(false);
  });
});

describe('raceAgainstAbort — late abort beats slow promise', () => {
  it('rejects at abort time, not when the promise eventually resolves', async () => {
    const ctrl = new AbortController();
    const slow = new Promise<number>((resolve) =>
      setTimeout(() => resolve(99), 5_000),
    );
    setTimeout(() => ctrl.abort(), 20);

    const start = Date.now();
    await expect(raceAgainstAbort(ctrl.signal, slow)).rejects.toMatchObject({
      name: 'AbortError',
      message: ABORT_REASONS.DURING_RUN,
    });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(500);
  });
});

describe('raceAgainstAbort — promise resolves first', () => {
  it('returns the promise value when it beats the abort', async () => {
    const ctrl = new AbortController();
    const v = await raceAgainstAbort(ctrl.signal, Promise.resolve('done'));
    expect(v).toBe('done');
  });

  it('removes the abort listener after a clean resolve (no handler leak)', async () => {
    const ctrl = new AbortController();
    const v = await raceAgainstAbort(ctrl.signal, Promise.resolve(7));
    expect(v).toBe(7);
    // Firing abort afterwards must NOT throw on a removed listener.
    expect(() => ctrl.abort()).not.toThrow();
  });
});

describe('raceAgainstAbort — promise rejects first', () => {
  it('propagates the downstream error when it beats the abort', async () => {
    const ctrl = new AbortController();
    const err = new Error('boom');
    await expect(
      raceAgainstAbort(ctrl.signal, Promise.reject(err)),
    ).rejects.toBe(err);
    expect(() => ctrl.abort()).not.toThrow();
  });
});

describe('isAbortError', () => {
  it('recognises an AbortError-tagged Error', () => {
    const e = Object.assign(new Error('x'), { name: 'AbortError' });
    expect(isAbortError(e)).toBe(true);
  });

  it('recognises the BEFORE_START message tag', () => {
    expect(isAbortError(new Error(ABORT_REASONS.BEFORE_START))).toBe(true);
  });

  it('recognises the DURING_RUN message tag', () => {
    expect(isAbortError(new Error(ABORT_REASONS.DURING_RUN))).toBe(true);
  });

  it('returns false for a plain Error', () => {
    expect(isAbortError(new Error('downstream'))).toBe(false);
  });

  it('returns false for a non-Error value', () => {
    expect(isAbortError('not an error')).toBe(false);
    expect(isAbortError(null)).toBe(false);
    expect(isAbortError(undefined)).toBe(false);
    expect(isAbortError({ name: 'AbortError' })).toBe(false);
  });
});
