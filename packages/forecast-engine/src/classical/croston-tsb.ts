/**
 * Croston / TSB — intermittent-demand forecasters.
 *
 * Intermittent series (spare parts, consumables, low-volume minerals)
 * are mostly zeros with occasional positive demands. Vanilla ETS /
 * ARIMA / transformers mishandle them. Two classical heuristics are the
 * deployment default:
 *
 *  - CROSTON (1972): exponentially smooth the non-zero demand SIZE and
 *    the INTER-arrival INTERVAL separately; forecast = size / interval.
 *    Only updates on a demand-occurring period — so it is blind to
 *    "demand has stopped".
 *
 *  - TSB (Teunter, Syntetos & Babai 2011): replaces the interval by a
 *    demand-PROBABILITY that is updated EVERY period (including zeros),
 *    so it decays toward zero when demand dries up. Forecast =
 *    probability * size. This is the modern default; it fixes Croston's
 *    obsolescence blind-spot.
 *
 * Both produce a FLAT rate forecast (the same value for every step) —
 * the correct behaviour for a rate estimate over intermittent demand.
 * Pure + deterministic.
 *
 * References: Croston 1972; Teunter, Syntetos & Babai, EJOR 2011.
 */

import type { ClassicalForecaster } from './types.js';

export interface CrostonConfig {
  /** Smoothing parameter in (0,1). Default 0.1 (Croston-recommended). */
  readonly alpha?: number;
}

export interface TsbConfig {
  /** Smoothing for demand probability in (0,1). Default 0.1. */
  readonly alphaProbability?: number;
  /** Smoothing for demand size in (0,1). Default 0.1. */
  readonly alphaSize?: number;
}

/** Classic Croston: size / interval, updated only on demand periods. */
export function createCroston(config: CrostonConfig = {}): ClassicalForecaster {
  const alpha = Math.min(1 - 1e-6, Math.max(1e-6, config.alpha ?? 0.1));
  return {
    name: 'croston',
    version: '1.0.0',
    forecast(history: ReadonlyArray<number>, horizon: number): number[] {
      const out: number[] = [];
      const rate = crostonRate(history, alpha);
      for (let h = 0; h < horizon; h++) out.push(rate);
      return out;
    },
  };
}

/** TSB: probability * size, probability updated every period. */
export function createTsb(config: TsbConfig = {}): ClassicalForecaster {
  const ap = Math.min(1 - 1e-6, Math.max(1e-6, config.alphaProbability ?? 0.1));
  const az = Math.min(1 - 1e-6, Math.max(1e-6, config.alphaSize ?? 0.1));
  return {
    name: 'tsb',
    version: '1.0.0',
    forecast(history: ReadonlyArray<number>, horizon: number): number[] {
      const out: number[] = [];
      const rate = tsbRate(history, ap, az);
      for (let h = 0; h < horizon; h++) out.push(rate);
      return out;
    },
  };
}

function crostonRate(history: ReadonlyArray<number>, alpha: number): number {
  const n = history.length;
  if (n === 0) return 0;
  // Initialise from the first non-zero demand.
  let firstNzIdx = -1;
  for (let i = 0; i < n; i++) {
    if ((history[i] as number) > 0) {
      firstNzIdx = i;
      break;
    }
  }
  if (firstNzIdx === -1) return 0; // all zeros
  let size = history[firstNzIdx] as number;
  let interval = firstNzIdx + 1; // periods up to and incl. first demand
  let sinceLast = 0;
  for (let i = firstNzIdx + 1; i < n; i++) {
    sinceLast += 1;
    const d = history[i] as number;
    if (d > 0) {
      size = alpha * d + (1 - alpha) * size;
      interval = alpha * sinceLast + (1 - alpha) * interval;
      sinceLast = 0;
    }
  }
  return interval <= 0 ? 0 : size / interval;
}

function tsbRate(
  history: ReadonlyArray<number>,
  alphaProb: number,
  alphaSize: number,
): number {
  const n = history.length;
  if (n === 0) return 0;
  // Initialise size from first non-zero; probability from base rate.
  let firstNzIdx = -1;
  for (let i = 0; i < n; i++) {
    if ((history[i] as number) > 0) {
      firstNzIdx = i;
      break;
    }
  }
  if (firstNzIdx === -1) return 0; // all zeros
  let size = history[firstNzIdx] as number;
  let prob = 1 / (firstNzIdx + 1);
  for (let i = firstNzIdx + 1; i < n; i++) {
    const d = history[i] as number;
    if (d > 0) {
      prob = alphaProb * 1 + (1 - alphaProb) * prob;
      size = alphaSize * d + (1 - alphaSize) * size;
    } else {
      prob = alphaProb * 0 + (1 - alphaProb) * prob;
    }
  }
  return prob * size;
}
