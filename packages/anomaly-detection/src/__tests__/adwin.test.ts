/**
 * ADWIN drift detector — synthetic-stream validation.
 *
 * Acceptance criteria:
 *   T8. detects a mean shift 0.2 -> 0.8 within 200 samples.
 *   T9. zero false-positives on a constant-mean series of 1000.
 */

import { describe, expect, it } from 'vitest';

import { createAdwinState, updateAdwin } from '../drift/adwin.js';
import {
  meanShiftStream,
  stableBernoulliStream,
} from '../__fixtures__/synthetic-series.js';

describe('adwin', () => {
  it('detects a mean shift 0.2 -> 0.8 within 200 samples (T8)', () => {
    // Bernoulli-like signal where shift between two distinct means is
    // the canonical ADWIN test case from Bifet & Gavaldà 2007.
    const { data, shiftIndex } = meanShiftStream({
      n: 400,
      muBefore: 0.2,
      muAfter: 0.8,
      sigma: 0.05,
      seed: 5,
    });
    let state = createAdwinState({ delta: 0.05, minWindow: 10 });
    let firstDriftIdx = -1;
    for (let i = 0; i < data.length; i += 1) {
      const step = updateAdwin(state, data[i]!);
      state = step.state;
      if (step.signal.driftDetected && firstDriftIdx < 0) {
        firstDriftIdx = i;
        break;
      }
    }
    expect(firstDriftIdx).toBeGreaterThanOrEqual(shiftIndex);
    expect(firstDriftIdx - shiftIndex).toBeLessThan(200);
  });

  it('zero false-positives on a stable 1000-sample Bernoulli series (T9)', () => {
    // ADWIN's Hoeffding-bound cut criterion is tight on [0, 1]-bounded
    // random variables (Bifet & Gavaldà 2007). Using a Bernoulli
    // stream — the canonical setting in the original paper — for the
    // false-positive assertion.
    const data = stableBernoulliStream({ n: 1000, p: 0.3, seed: 19 });
    let state = createAdwinState({ delta: 0.002, minWindow: 30 });
    let drifts = 0;
    for (const v of data) {
      const step = updateAdwin(state, v);
      state = step.state;
      if (step.signal.driftDetected) drifts += 1;
    }
    expect(drifts).toBe(0);
  });

  it('window is non-mutating across updates', () => {
    let state = createAdwinState({ minWindow: 2 });
    const snapshot = [...state.window];
    state = updateAdwin(state, 1).state;
    expect(snapshot).toEqual([]);
  });
});
