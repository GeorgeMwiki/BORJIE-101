/**
 * Cost guard tests.
 */

import { describe, expect, it } from 'vitest';
import { createCostGuard } from '../cost/cost-guard.js';
import { MediaEngineError } from '../types.js';

describe('cost guard', () => {
  it('reserves within budget and reports remaining', () => {
    const guard = createCostGuard(100);
    const r = guard.reserve(30, 'r1');
    expect(r.amountCents).toBe(30);
    expect(guard.remainingCents).toBe(70);
  });

  it('caps spend — reservation over remaining budget throws budget_exceeded', () => {
    const guard = createCostGuard(50);
    expect(() => guard.reserve(51, 'r1')).toThrowError(MediaEngineError);
    try {
      guard.reserve(51, 'r2');
    } catch (e) {
      expect((e as MediaEngineError).code).toBe('budget_exceeded');
    }
  });

  it('commit makes spend final and reduces remaining', () => {
    const guard = createCostGuard(100);
    const r = guard.reserve(40, 'r1');
    guard.commit(r);
    expect(guard.remainingCents).toBe(60);
  });

  it('release refunds an outstanding reservation', () => {
    const guard = createCostGuard(100);
    const r = guard.reserve(40, 'r1');
    expect(guard.remainingCents).toBe(60);
    guard.release(r);
    expect(guard.remainingCents).toBe(100);
  });

  it('cumulative reservations respect the ceiling', () => {
    const guard = createCostGuard(100);
    guard.reserve(60, 'r1');
    expect(() => guard.reserve(50, 'r2')).toThrowError(MediaEngineError);
    guard.reserve(40, 'r3'); // exactly fits
    expect(guard.remainingCents).toBe(0);
  });

  it('rejects a negative budget', () => {
    expect(() => createCostGuard(-1)).toThrowError(MediaEngineError);
  });

  it('allows a zero-cost reservation (stub path)', () => {
    const guard = createCostGuard(0);
    const r = guard.reserve(0, 'free');
    guard.commit(r);
    expect(guard.remainingCents).toBe(0);
  });
});
