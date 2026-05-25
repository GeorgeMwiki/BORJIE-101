/**
 * NoShowProcess — Bernoulli with smoothed Beta posterior per vendor.
 *
 * Each vendor's no-show rate is updated as new appointments resolve.
 * Prior is Beta(1, 4) — assumes vendors generally show up.
 */

import { mulberry32 } from '../../util/rng.js';

export interface NoShowObservation {
  readonly vendorId: string;
  readonly noShow: boolean;
}

export interface NoShowParams {
  readonly vendorId: string;
  readonly alpha: number;
  readonly beta: number;
  readonly sampleSize: number;
}

export function fitNoShow(
  obs: ReadonlyArray<NoShowObservation>,
  vendorId: string,
): NoShowParams {
  let alpha = 1;
  let beta = 4;
  let n = 0;
  for (const o of obs) {
    if (o.vendorId !== vendorId) continue;
    if (o.noShow) alpha += 1;
    else beta += 1;
    n += 1;
  }
  return { vendorId, alpha, beta, sampleSize: n };
}

export function noShowRate(params: NoShowParams): number {
  return params.alpha / (params.alpha + params.beta);
}

export function sampleNoShow(
  params: NoShowParams,
  seed: number,
): boolean {
  const rng = mulberry32(seed);
  return rng() < noShowRate(params);
}
