import { describe, expect, it } from 'vitest';
import { createRdpAccountant } from '../composition/rdp-accountant.js';
import { rdpToDp, RdpToDpError } from '../composition/rdp-to-dp.js';

describe('rdpToDp', () => {
  // Closed-form sanity at σ=1, T=1, δ=1e-5.
  // ε(α) = α/2 + log(1/δ)/(α-1).  Minimum over α > 1 reached at
  // α* = 1 + sqrt(2 log(1/δ)). Plugging back gives the tight bound.
  it('matches the closed-form minimum for unsubsampled Gaussian σ=1 T=1', () => {
    const accountant = createRdpAccountant();
    // Use a dense grid around the optimum.
    const orders: number[] = [];
    for (let a = 2; a <= 64; a += 0.5) orders.push(a);
    const curve = accountant.composeGaussian(
      { noiseSigma: 1, steps: 1 },
      orders,
    );
    const result = rdpToDp({ curve, delta: 1e-5 });

    // Analytical minimum for ε(α) = α/2 + log(1/δ)/(α-1).
    const logInvDelta = Math.log(1 / 1e-5);
    const aStar = 1 + Math.sqrt(2 * logInvDelta);
    const refEpsilon = aStar / 2 + logInvDelta / (aStar - 1);

    expect(result.epsilon).toBeGreaterThan(0);
    expect(result.delta).toBe(1e-5);
    // Closed form is upper bound — our grid search should be within
    // 1e-2 of it. (Grid step 0.5; analytical α* ≈ 5.8.)
    expect(Math.abs(result.epsilon - refEpsilon)).toBeLessThan(1e-2);
  });

  it('refuses δ out of (0,1)', () => {
    const curve = [
      { order: 2, epsilon: 1 },
      { order: 4, epsilon: 2 },
    ];
    expect(() => rdpToDp({ curve, delta: 0 })).toThrow(RdpToDpError);
    expect(() => rdpToDp({ curve, delta: 1 })).toThrow(RdpToDpError);
    expect(() => rdpToDp({ curve, delta: -0.1 })).toThrow(RdpToDpError);
  });

  it('refuses empty curve', () => {
    expect(() => rdpToDp({ curve: [], delta: 1e-5 })).toThrow(
      RdpToDpError,
    );
  });

  it('refuses curve with α ≤ 1', () => {
    const curve = [{ order: 1, epsilon: 0.1 }];
    expect(() => rdpToDp({ curve, delta: 1e-5 })).toThrow(RdpToDpError);
  });
});
