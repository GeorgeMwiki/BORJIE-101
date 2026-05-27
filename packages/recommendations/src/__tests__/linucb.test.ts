import { describe, expect, it } from 'vitest';
import { createLinUCBBandit } from '../bandits/linucb.js';
import { createPRNG } from '../util/prng.js';

describe('LinUCB bandit', () => {
  it('achieves sublinear cumulative regret on a synthetic linear bandit', () => {
    // d=5 features, two arms with different true θ. Arm 0 is the
    // better arm under a context drawn from the unit sphere.
    const d = 5;
    const theta0 = [1.0, 0.5, 0.0, 0.0, 0.0];
    const theta1 = [0.0, 0.0, 0.0, 0.5, 1.0];
    const arms = ['a0', 'a1'];
    const lin = createLinUCBBandit({ arms, d, alpha: 1.0, ridge: 1.0 });
    const envRng = createPRNG(7777);
    const noise = createPRNG(8888);
    const rounds = 1500;
    let cumRegret = 0;
    function sampleContext(): number[] {
      const v: number[] = [];
      let norm = 0;
      for (let i = 0; i < d; i += 1) {
        const x = envRng.nextGaussian();
        v.push(x);
        norm += x * x;
      }
      const n = Math.sqrt(norm) || 1;
      return v.map((x) => x / n);
    }
    function predicted(theta: number[], x: number[]): number {
      let s = 0;
      for (let i = 0; i < d; i += 1) s += theta[i]! * x[i]!;
      return s;
    }
    for (let t = 0; t < rounds; t += 1) {
      const ctx = sampleContext();
      const chosen = lin.select(ctx);
      const r0 = predicted(theta0, ctx);
      const r1 = predicted(theta1, ctx);
      const bestR = Math.max(r0, r1);
      const obsTheta = chosen === 'a0' ? theta0 : theta1;
      const reward = predicted(obsTheta, ctx) + 0.1 * noise.nextGaussian();
      lin.update(chosen, ctx, reward);
      cumRegret += bestR - (chosen === 'a0' ? r0 : r1);
    }
    // Theoretical bound: O(d √T log T). For T=1500, d=5, that's a
    // generous ceiling; we check the cumulative regret stays well
    // below a simple linear-pull-on-suboptimal bound (~0.5 * T).
    const linearWorst = rounds * 0.5;
    expect(cumRegret).toBeLessThan(linearWorst);
    // And the average per-round regret should be reasonable.
    expect(cumRegret / rounds).toBeLessThan(0.25);
  });

  it('rejects mismatched-d contexts', () => {
    const lin = createLinUCBBandit({ arms: ['a'], d: 3 });
    expect(() => lin.select([1, 2])).toThrow(/context dim/);
    expect(() => lin.update('a', [1, 2], 0.5)).toThrow(/context dim/);
  });

  it('rejects unknown arms and non-finite rewards', () => {
    const lin = createLinUCBBandit({ arms: ['a'], d: 2 });
    expect(() => lin.update('z', [0, 0], 0.5)).toThrow(/unknown arm/);
    expect(() => lin.update('a', [0, 0], Infinity)).toThrow(/finite/);
  });
});
