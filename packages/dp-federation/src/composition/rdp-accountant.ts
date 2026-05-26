/**
 * RDP accountant — Mironov 2017 closed-form for the unsubsampled
 * Gaussian mechanism.
 *
 * For the Gaussian mechanism with sensitivity 1 and noise scale σ,
 * the RDP curve is
 *
 *   ε_α(σ) = α / (2 σ²).
 *
 * For T independent applications, by composition (Rényi composition,
 * Proposition 1 of Mironov 2017), ε_α scales linearly with T:
 *
 *   ε_α(σ, T) = T · α / (2 σ²).
 *
 * This file ships the closed-form path only. The numerically-tight
 * subsampled Gaussian (Wang-Balle-Kasiviswanathan 2019) is a
 * follow-up wave; the subsampled estimator is marked xfail-with-
 * citation if numerics deviate from the closed-form by > 1e-6.
 *
 * Reference: Mironov 2017, "Rényi Differential Privacy", CSF 2017,
 * https://arxiv.org/abs/1702.07476, Proposition 4 + §3.
 */

import type {
  GaussianApplication,
  RdpAccountant,
  RdpPoint,
} from '../types.js';
import { DEFAULT_RDP_ORDERS } from '../types.js';

export class RdpAccountantError extends Error {
  public override readonly name = 'RdpAccountantError';
}

/**
 * Closed-form Gaussian RDP at order α, sensitivity 1, noise σ, T
 * applications.
 */
export function gaussianRdp(
  order: number,
  sigma: number,
  steps: number,
): number {
  if (!Number.isFinite(order) || order <= 1) {
    throw new RdpAccountantError(
      `Rényi order must be > 1 (got ${order})`,
    );
  }
  if (!Number.isFinite(sigma) || sigma <= 0) {
    throw new RdpAccountantError(
      `Noise sigma must be > 0 (got ${sigma})`,
    );
  }
  if (!Number.isInteger(steps) || steps < 1) {
    throw new RdpAccountantError(
      `Steps must be a positive integer (got ${steps})`,
    );
  }
  return (steps * order) / (2 * sigma * sigma);
}

export function createRdpAccountant(): RdpAccountant {
  return Object.freeze({
    composeGaussian(
      application: GaussianApplication,
      orders: ReadonlyArray<number> = DEFAULT_RDP_ORDERS,
    ): ReadonlyArray<RdpPoint> {
      return orders.map((order) =>
        Object.freeze({
          order,
          epsilon: gaussianRdp(order, application.noiseSigma, application.steps),
        }),
      );
    },

    compose(
      curves: ReadonlyArray<ReadonlyArray<RdpPoint>>,
    ): ReadonlyArray<RdpPoint> {
      if (curves.length === 0) return [];
      // All curves must share the same order grid.
      const first = curves[0];
      if (!first || first.length === 0) return [];
      const orders = first.map((p) => p.order);

      // Sanity check shape.
      for (const curve of curves) {
        if (curve.length !== orders.length) {
          throw new RdpAccountantError(
            'All curves must share the same Rényi-order grid',
          );
        }
        for (let i = 0; i < curve.length; i += 1) {
          const point = curve[i];
          const expected = orders[i];
          if (point === undefined || expected === undefined) {
            throw new RdpAccountantError(
              'Curve grid contains undefined element',
            );
          }
          if (point.order !== expected) {
            throw new RdpAccountantError(
              `Curve grid mismatch at index ${i}: ${point.order} vs ${expected}`,
            );
          }
        }
      }

      // Additive composition at each order.
      return orders.map((order, i) => {
        let sum = 0;
        for (const curve of curves) {
          const point = curve[i];
          if (point === undefined) {
            throw new RdpAccountantError('Curve index out of range');
          }
          sum += point.epsilon;
        }
        return Object.freeze({ order, epsilon: sum });
      });
    },
  });
}
