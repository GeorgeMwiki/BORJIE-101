import { describe, expect, it } from 'vitest';
import { addFairnessConstraint } from '../fairness-constraint.js';
import type { DisparityScore, FairnessConstraint } from '../../types.js';

describe('addFairnessConstraint', () => {
  it('converges by raising lambda until disparity is below max', async () => {
    // Synthetic: each trainer call halves the disparity.
    let disparity = 0.8;
    const inner = async (): Promise<{ tag: 'm' }> => {
      disparity = disparity / 2;
      return { tag: 'm' };
    };
    const evaluator = async (): Promise<DisparityScore> => ({
      metric: 'demographic_parity',
      score: disparity,
      perGroup: {},
      violates: disparity > 0.05,
      threshold: 0.05,
      interpretation: '',
    });
    const constraint: FairnessConstraint = {
      metric: 'demographic_parity',
      maxDisparity: 0.05,
      lambda: 0.1,
    };
    const result = await addFairnessConstraint<number, { tag: 'm' }>({
      innerTrainer: inner,
      evaluator,
      constraint,
      initialRows: [1, 2, 3],
      maxIterations: 10,
    });
    expect(result.converged).toBe(true);
    expect(result.finalDisparity.score).toBeLessThanOrEqual(0.05);
  });

  it('returns the (failed) attempt when maxIterations exhausted', async () => {
    const inner = async (): Promise<{ tag: 'm' }> => ({ tag: 'm' });
    const evaluator = async (): Promise<DisparityScore> => ({
      metric: 'demographic_parity',
      score: 0.5, // never improves
      perGroup: {},
      violates: true,
      threshold: 0.05,
      interpretation: '',
    });
    const constraint: FairnessConstraint = {
      metric: 'demographic_parity',
      maxDisparity: 0.05,
    };
    const result = await addFairnessConstraint<number, { tag: 'm' }>({
      innerTrainer: inner,
      evaluator,
      constraint,
      initialRows: [1],
      maxIterations: 3,
    });
    expect(result.converged).toBe(false);
    expect(result.iterations).toBe(3);
  });
});
