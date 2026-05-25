import { describe, expect, it } from 'vitest';
import { adversarialDebiasing } from '../adversarial-debiasing.js';

describe('adversarialDebiasing', () => {
  it('halts when adversary accuracy approaches chance', async () => {
    let advAcc = 0.9;
    const predictor = {
      trainStep: async () => {
        advAcc -= 0.2;
      },
      predict: async () => 'o',
    };
    const adversary = {
      trainAndScore: async () => advAcc,
      nGroups: 2,
    };
    const result = await adversarialDebiasing<{ id: number }, string>({
      predictor,
      adversary,
      rows: [{ id: 1 }, { id: 2 }],
      groupOf: () => 'M',
      stoppingTol: 0.05,
      maxEpochs: 10,
    });
    expect(result.converged).toBe(true);
    expect(result.finalAdversaryAccuracy).toBeLessThanOrEqual(
      result.chanceAccuracy + 0.05,
    );
  });

  it('reports non-convergence after maxEpochs if adversary stays high', async () => {
    const predictor = {
      trainStep: async () => {},
      predict: async () => 'o',
    };
    const adversary = { trainAndScore: async () => 0.95, nGroups: 2 };
    const result = await adversarialDebiasing<number, string>({
      predictor,
      adversary,
      rows: [1],
      groupOf: () => 'M',
      stoppingTol: 0.05,
      maxEpochs: 2,
    });
    expect(result.converged).toBe(false);
    expect(result.epochs).toBe(2);
  });
});
