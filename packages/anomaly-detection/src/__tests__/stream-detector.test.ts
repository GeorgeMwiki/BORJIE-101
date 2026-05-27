/**
 * Online stream wrapper — warm-up / windowing tests.
 */

import { describe, expect, it } from 'vitest';

import {
  createUnivariateStreamState,
  pushUnivariate,
} from '../online/stream-detector.js';
import { stableGaussianStream } from '../__fixtures__/synthetic-series.js';

describe('stream-detector', () => {
  it('emits null score during warmup and a real score thereafter', () => {
    let state = createUnivariateStreamState('zscore', {
      warmup: 10,
      maxWindow: 100,
      refitEvery: 50,
    });
    let firstScored = -1;
    const data = stableGaussianStream({ n: 30, mu: 0, sigma: 1, seed: 51 });
    for (let i = 0; i < data.length; i += 1) {
      const step = pushUnivariate(state, data[i]!);
      state = step.state;
      if (step.score && firstScored < 0) firstScored = i;
    }
    expect(firstScored).toBe(9); // 10th sample, 0-indexed
  });

  it('window is capped at maxWindow', () => {
    let state = createUnivariateStreamState('mad', {
      warmup: 5,
      maxWindow: 20,
    });
    for (let i = 0; i < 100; i += 1) {
      state = pushUnivariate(state, i + 0.5).state;
    }
    expect(state.window.length).toBe(20);
  });

  it('mad-kind stream detector flags a planted outlier', () => {
    let state = createUnivariateStreamState('mad', {
      warmup: 30,
      maxWindow: 200,
    });
    const data = stableGaussianStream({ n: 200, mu: 10, sigma: 1, seed: 53 });
    let flagged = false;
    for (const v of data) {
      const step = pushUnivariate(state, v);
      state = step.state;
      if (step.warm && step.score?.anomalous) flagged = true;
    }
    // Should not flag anything in a stable stream.
    expect(flagged).toBe(false);
    // Now push a huge outlier and observe it gets flagged.
    const step = pushUnivariate(state, 100);
    expect(step.score?.anomalous).toBe(true);
  });
});
