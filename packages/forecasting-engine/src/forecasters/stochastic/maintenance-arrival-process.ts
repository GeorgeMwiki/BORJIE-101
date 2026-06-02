/**
 * MaintenanceArrivalProcess — Poisson per asset class.
 *
 * Tickets arrive at a class-specific rate. The orchestrator queries
 * the rate, then the queue simulator generates the arrival stream.
 */

import { samplePoisson, mulberry32 } from '../../util/rng.js';

export type AssetClass = 'A' | 'B' | 'C' | 'D';

/** @deprecated Use {@link AssetClass}. */
export type PropertyClass = AssetClass;

const DEFAULT_RATES: Record<AssetClass, number> = {
  A: 0.05, // tickets / unit / day
  B: 0.08,
  C: 0.15,
  D: 0.25,
};

export interface MaintenanceArrivalParams {
  readonly assetClass: AssetClass;
  readonly ratePerUnitPerDay: number;
  readonly unitCount: number;
}

export function defaultArrivalParams(
  assetClass: AssetClass,
  unitCount: number,
): MaintenanceArrivalParams {
  return {
    assetClass,
    ratePerUnitPerDay: DEFAULT_RATES[assetClass],
    unitCount,
  };
}

export interface MaintenanceArrivalSampleOptions {
  readonly params: MaintenanceArrivalParams;
  readonly horizonDays: number;
  readonly seed: number;
}

export function sampleArrivalsPerDay(
  opts: MaintenanceArrivalSampleOptions,
): ReadonlyArray<number> {
  const rng = mulberry32(opts.seed);
  const lambda = opts.params.ratePerUnitPerDay * opts.params.unitCount;
  const out: number[] = [];
  for (let d = 0; d < opts.horizonDays; d += 1) {
    out.push(samplePoisson(rng, lambda));
  }
  return out;
}

export function expectedArrivalsOverHorizon(
  params: MaintenanceArrivalParams,
  horizonDays: number,
): number {
  return params.ratePerUnitPerDay * params.unitCount * horizonDays;
}
