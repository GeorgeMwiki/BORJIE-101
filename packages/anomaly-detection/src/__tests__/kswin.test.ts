/**
 * KSWIN drift detector — synthetic-stream validation.
 *
 * Acceptance criteria:
 *   T10. detects a distribution shift N(0,1) -> N(2,1).
 *   T11. zero false-positives when both windows are drawn from the
 *        same distribution.
 */

import { describe, expect, it } from 'vitest';

import { createKswinState, updateKswin } from '../drift/kswin.js';
import {
  meanShiftStream,
  stableGaussianStream,
} from '../__fixtures__/synthetic-series.js';

describe('kswin', () => {
  it('detects N(0,1) -> N(2,1) distribution shift (T10)', () => {
    const { data, shiftIndex } = meanShiftStream({
      n: 600,
      muBefore: 0,
      muAfter: 2,
      sigma: 1,
      seed: 13,
    });
    let state = createKswinState({ windowSize: 100, alpha: 0.005 });
    let drifted = false;
    let driftIdx = -1;
    for (let i = 0; i < data.length; i += 1) {
      const step = updateKswin(state, data[i]!);
      state = step.state;
      if (step.signal.driftDetected && !drifted) {
        drifted = true;
        driftIdx = i;
        break;
      }
    }
    expect(drifted).toBe(true);
    expect(driftIdx).toBeGreaterThanOrEqual(shiftIndex);
  });

  it('zero false-positives on stable N(0,1) stream (T11)', () => {
    const data = stableGaussianStream({
      n: 600,
      mu: 0,
      sigma: 1,
      seed: 29,
    });
    let state = createKswinState({ windowSize: 100, alpha: 0.005 });
    let drifts = 0;
    for (const v of data) {
      const step = updateKswin(state, v);
      state = step.state;
      if (step.signal.driftDetected) drifts += 1;
    }
    expect(drifts).toBe(0);
  });

  it('buffer caps at 2 * windowSize', () => {
    let state = createKswinState({ windowSize: 5 });
    for (let i = 0; i < 100; i += 1) {
      state = updateKswin(state, i).state;
    }
    expect(state.buffer.length).toBe(10);
  });
});
