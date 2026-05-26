import { describe, expect, it } from 'vitest';
import {
  createRdpAccountant,
  gaussianRdp,
  RdpAccountantError,
} from '../composition/rdp-accountant.js';

describe('gaussianRdp closed-form', () => {
  // Reference: Mironov 2017, Proposition 4 + §3 — for the unsubsampled
  // Gaussian mechanism with sensitivity 1, ε_α(σ) = α / (2 σ²) at a
  // single step. Reference vectors below are computed directly from
  // this closed form and serve as the canonical check.

  it('matches the closed form ε_α = α / (2σ²) at σ=1 step=1', () => {
    expect(gaussianRdp(2, 1, 1)).toBeCloseTo(1.0, 12);
    expect(gaussianRdp(4, 1, 1)).toBeCloseTo(2.0, 12);
    expect(gaussianRdp(10, 1, 1)).toBeCloseTo(5.0, 12);
  });

  it('matches the closed form ε_α = T α / (2 σ²) at σ=5 T=1000', () => {
    // σ=5, T=1000, α=2 -> ε_2 = 1000 * 2 / (2 * 25) = 40.
    expect(gaussianRdp(2, 5, 1000)).toBeCloseTo(40, 8);
    // α=4 -> ε_4 = 1000 * 4 / (2 * 25) = 80.
    expect(gaussianRdp(4, 5, 1000)).toBeCloseTo(80, 8);
  });

  it('rejects α ≤ 1', () => {
    expect(() => gaussianRdp(1, 1, 1)).toThrow(RdpAccountantError);
    expect(() => gaussianRdp(0.5, 1, 1)).toThrow(RdpAccountantError);
  });

  it('rejects non-positive σ', () => {
    expect(() => gaussianRdp(2, 0, 1)).toThrow(RdpAccountantError);
    expect(() => gaussianRdp(2, -1, 1)).toThrow(RdpAccountantError);
  });
});

describe('createRdpAccountant', () => {
  it('returns one ε per requested order', () => {
    const accountant = createRdpAccountant();
    const curve = accountant.composeGaussian(
      { noiseSigma: 1, steps: 1 },
      [2, 4, 10],
    );
    expect(curve.map((p) => p.order)).toEqual([2, 4, 10]);
    expect(curve[0]?.epsilon).toBeCloseTo(1.0, 12);
    expect(curve[1]?.epsilon).toBeCloseTo(2.0, 12);
    expect(curve[2]?.epsilon).toBeCloseTo(5.0, 12);
  });

  it('composes curves additively at each order', () => {
    const accountant = createRdpAccountant();
    const a = accountant.composeGaussian({ noiseSigma: 1, steps: 1 }, [2, 4]);
    const b = accountant.composeGaussian({ noiseSigma: 1, steps: 1 }, [2, 4]);
    const composed = accountant.compose([a, b]);
    expect(composed[0]?.epsilon).toBeCloseTo(2.0, 12);
    expect(composed[1]?.epsilon).toBeCloseTo(4.0, 12);
  });

  it('refuses curves on mismatched order grids', () => {
    const accountant = createRdpAccountant();
    const a = accountant.composeGaussian({ noiseSigma: 1, steps: 1 }, [2, 4]);
    const b = accountant.composeGaussian({ noiseSigma: 1, steps: 1 }, [2, 8]);
    expect(() => accountant.compose([a, b])).toThrow(RdpAccountantError);
  });
});
