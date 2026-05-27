/**
 * Page-Hinkley drift detector — synthetic-stream validation.
 *
 * Acceptance criterion:
 *   T12. detects a sudden mean shift within ~ λ / Δμ samples.
 */

import { describe, expect, it } from 'vitest';

import {
  createPageHinkleyState,
  updatePageHinkley,
} from '../drift/page-hinkley.js';
import {
  meanShiftStream,
  stableGaussianStream,
} from '../__fixtures__/synthetic-series.js';

describe('page-hinkley', () => {
  it('detects a sudden mean shift within ~λ/Δμ samples (T12)', () => {
    // Δμ = 1.0; λ = 20 → expect drift within ~ 20 samples of shift.
    const { data, shiftIndex } = meanShiftStream({
      n: 400,
      muBefore: 0,
      muAfter: 1,
      sigma: 0.1,
      seed: 31,
    });
    let state = createPageHinkleyState({
      delta: 0.01,
      threshold: 20,
      alpha: 1,
    });
    let driftIdx = -1;
    for (let i = 0; i < data.length; i += 1) {
      const step = updatePageHinkley(state, data[i]!);
      state = step.state;
      if (step.signal.driftDetected && driftIdx < 0) {
        driftIdx = i;
        break;
      }
    }
    expect(driftIdx).toBeGreaterThanOrEqual(shiftIndex);
    expect(driftIdx - shiftIndex).toBeLessThan(100);
  });

  it('zero drifts on a stable series', () => {
    const data = stableGaussianStream({ n: 500, mu: 5, sigma: 0.1, seed: 41 });
    let state = createPageHinkleyState({ threshold: 50 });
    let drifts = 0;
    for (const v of data) {
      const step = updatePageHinkley(state, v);
      state = step.state;
      if (step.signal.driftDetected) drifts += 1;
    }
    expect(drifts).toBe(0);
  });

  it('also detects a decrease in the mean (PH- branch)', () => {
    const { data, shiftIndex } = meanShiftStream({
      n: 400,
      muBefore: 5,
      muAfter: 4,
      sigma: 0.1,
      seed: 43,
    });
    let state = createPageHinkleyState({
      delta: 0.01,
      threshold: 20,
      alpha: 1,
    });
    let driftIdx = -1;
    for (let i = 0; i < data.length; i += 1) {
      const step = updatePageHinkley(state, data[i]!);
      state = step.state;
      if (step.signal.driftDetected && driftIdx < 0) {
        driftIdx = i;
        break;
      }
    }
    expect(driftIdx).toBeGreaterThanOrEqual(shiftIndex);
  });
});
