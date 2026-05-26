/**
 * RDP -> (ε, δ) conversion.
 *
 * Given a composed RDP curve {(α_i, ε_α_i)}, the tightest (ε, δ) at a
 * target δ is
 *
 *   ε = min_α ( ε_α + log(1/δ) / (α - 1) ).
 *
 * Reference: Mironov 2017, "Rényi Differential Privacy", CSF 2017,
 * Proposition 3.
 */

import type { DpGuarantee, RdpPoint } from '../types.js';

export class RdpToDpError extends Error {
  public override readonly name = 'RdpToDpError';
}

export interface RdpToDpParams {
  readonly curve: ReadonlyArray<RdpPoint>;
  readonly delta: number;
}

/**
 * Convert an RDP curve to a single (ε, δ) guarantee at the target δ.
 * Picks the tightest ε across the curve's order grid.
 */
export function rdpToDp(params: RdpToDpParams): DpGuarantee {
  const { curve, delta } = params;

  if (!Number.isFinite(delta) || delta <= 0 || delta >= 1) {
    throw new RdpToDpError(`delta must lie in (0, 1) (got ${delta})`);
  }
  if (curve.length === 0) {
    throw new RdpToDpError('Empty RDP curve cannot be converted');
  }

  const logInvDelta = Math.log(1 / delta);
  let best = Number.POSITIVE_INFINITY;
  for (const point of curve) {
    if (point.order <= 1) {
      throw new RdpToDpError(
        `Rényi order must be > 1 (got ${point.order})`,
      );
    }
    if (!Number.isFinite(point.epsilon)) {
      throw new RdpToDpError(
        `Non-finite ε at order ${point.order}`,
      );
    }
    const candidate = point.epsilon + logInvDelta / (point.order - 1);
    if (candidate < best) {
      best = candidate;
    }
  }

  if (!Number.isFinite(best)) {
    throw new RdpToDpError('Conversion did not find finite ε');
  }

  return Object.freeze({ epsilon: best, delta });
}
