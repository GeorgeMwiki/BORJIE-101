import { describe, expect, it } from 'vitest';
import { createThompsonSamplingBandit } from '../bandits/thompson-sampling.js';
import { createPRNG } from '../util/prng.js';

describe('Thompson Sampling bandit', () => {
  it('converges to the best arm on a synthetic Bernoulli bandit', () => {
    // 10 arms; arm 0 has p=0.7; arms 1..9 have p in [0.1, 0.3].
    const arms = ['a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9'];
    const probs = [0.7, 0.1, 0.15, 0.2, 0.25, 0.3, 0.1, 0.15, 0.2, 0.25];
    const bestP = Math.max(...probs);
    const ts = createThompsonSamplingBandit({ arms, seed: 12345 });
    const envRng = createPRNG(99999);
    const rounds = 3000;
    let cumRegret = 0;
    let bestArmPullCount = 0;
    for (let t = 0; t < rounds; t += 1) {
      const arm = ts.select();
      const idx = arms.indexOf(arm);
      const p = probs[idx]!;
      const reward = envRng.next() < p ? 1 : 0;
      ts.update(arm, reward);
      cumRegret += bestP - p;
      if (idx === 0) bestArmPullCount += 1;
    }
    const avgRegret = cumRegret / rounds;
    // After 3000 pulls, the average per-round regret must be small
    // (well below the gap to the second-best arm of 0.4).
    expect(avgRegret).toBeLessThan(0.1);
    // And the best arm must have been pulled the majority of the time.
    expect(bestArmPullCount).toBeGreaterThan(rounds * 0.6);
  });

  it('produces deterministic selections under a fixed seed', () => {
    const arms = ['a', 'b', 'c'];
    const ts1 = createThompsonSamplingBandit({ arms, seed: 42 });
    const ts2 = createThompsonSamplingBandit({ arms, seed: 42 });
    const seq1: string[] = [];
    const seq2: string[] = [];
    for (let i = 0; i < 50; i += 1) {
      seq1.push(ts1.select());
      seq2.push(ts2.select());
    }
    expect(seq1).toEqual(seq2);
  });

  it('rejects updates with rewards outside [0, 1]', () => {
    const ts = createThompsonSamplingBandit({ arms: ['a'], seed: 1 });
    expect(() => ts.update('a', -0.1)).toThrow();
    expect(() => ts.update('a', 1.1)).toThrow();
    expect(() => ts.update('a', NaN)).toThrow();
  });

  it('rejects updates targeting an unknown arm', () => {
    const ts = createThompsonSamplingBandit({ arms: ['a', 'b'], seed: 1 });
    expect(() => ts.update('z', 1)).toThrow(/unknown arm z/);
  });
});
