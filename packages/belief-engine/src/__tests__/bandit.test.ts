/**
 * LinUCB contextual bandit tests (LP-18). Verifies UCB scoring, the
 * exploration bonus, the A/b update, arm selection, and that a freshly
 * rewarded arm's exploit term moves toward the reward direction.
 */

import { describe, it, expect } from 'vitest';

import {
  createArmState,
  ucbScore,
  updateArmState,
  selectArmByUcb,
} from '../bandit.js';

describe('LinUCB bandit', () => {
  it('initialises A = I, b = 0', () => {
    const arm = createArmState(3);
    expect(arm.d).toBe(3);
    expect(arm.A[0]).toEqual([1, 0, 0]);
    expect(arm.A[1]).toEqual([0, 1, 0]);
    expect(arm.b).toEqual([0, 0, 0]);
  });

  it('a fresh arm scores purely from the exploration bonus', () => {
    const arm = createArmState(2);
    // theta = 0 so exploit = 0; variance = xᵀ I⁻¹ x = |x|² = 1.
    const score = ucbScore(arm, [1, 0], 1.0);
    expect(score).toBeCloseTo(1.0, 5);
  });

  it('exploration bonus scales with alpha', () => {
    const arm = createArmState(2);
    const low = ucbScore(arm, [1, 0], 0.5);
    const high = ucbScore(arm, [1, 0], 2.0);
    expect(high).toBeGreaterThan(low);
  });

  it('updates A and b after observing a reward', () => {
    const arm = createArmState(2);
    const updated = updateArmState(arm, [1, 0], 1.0);
    // A += x·xᵀ → A[0][0] = 2; b += reward·x → b[0] = 1.
    expect(updated.A[0][0]).toBe(2);
    expect(updated.b[0]).toBe(1);
    // Original arm untouched (immutability).
    expect(arm.A[0][0]).toBe(1);
    expect(arm.b[0]).toBe(0);
  });

  it('raises the exploit estimate after a positive reward', () => {
    let arm = createArmState(2);
    arm = updateArmState(arm, [1, 0], 1.0);
    arm = updateArmState(arm, [1, 0], 1.0);
    // theta·x should now be positive for the rewarded direction.
    const score = ucbScore(arm, [1, 0], 0); // alpha 0 → pure exploit
    expect(score).toBeGreaterThan(0);
  });

  it('throws on a feature-length mismatch', () => {
    const arm = createArmState(2);
    expect(() => ucbScore(arm, [1], 1)).toThrow();
    expect(() => updateArmState(arm, [1, 2, 3], 1)).toThrow();
  });

  it('rejects a non-finite reward', () => {
    const arm = createArmState(2);
    expect(() => updateArmState(arm, [1, 0], Infinity)).toThrow();
  });

  it('selects the best arm by UCB', () => {
    let good = createArmState(2);
    good = updateArmState(good, [1, 0], 1.0);
    good = updateArmState(good, [1, 0], 1.0);
    const fresh = createArmState(2);
    const arms = new Map([
      ['good', good],
      ['fresh', fresh],
    ]);
    const picked = selectArmByUcb(arms, [1, 0], { alpha: 0, d: 2 });
    expect(picked?.armId).toBe('good');
  });

  it('returns null when there are no arms', () => {
    expect(
      selectArmByUcb(new Map(), [1, 0], { alpha: 1, d: 2 }),
    ).toBeNull();
  });
});
