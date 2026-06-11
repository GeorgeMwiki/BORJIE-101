/**
 * ETS / Theta-style smoother — a lightweight, deterministic level +
 * trend extrapolator that combines:
 *
 *  - Simple exponential smoothing of the LEVEL (ETS(A,N,N) core), and
 *  - The THETA method's drift: half the slope of the ordinary-least-
 *    squares trend line through the history (Assimakopoulos &
 *    Nikolopoulos 2000; Hyndman & Billah 2003 show Theta == SES + drift
 *    where drift = b/2 and b is the OLS slope).
 *
 * Forecast:  yhat_{T+h} = level_T + drift * h
 *
 * This is the classic "Theta" winner of the M3 competition reduced to
 * its closed form — no optimisation loop, fully deterministic, and a
 * genuinely strong floor for trended non-seasonal series.
 *
 * Pure; never mutates inputs.
 */

import type { ClassicalForecaster } from './types.js';

export interface EtsThetaConfig {
  /**
   * Smoothing parameter for the level (alpha) in (0,1]. Higher =
   * more weight on recent observations. Default 0.5.
   */
  readonly alpha?: number;
}

/** Ordinary-least-squares slope of y on the index 0..n-1. */
function olsSlope(history: ReadonlyArray<number>): number {
  const n = history.length;
  if (n < 2) return 0;
  const meanX = (n - 1) / 2;
  let meanY = 0;
  for (const v of history) meanY += v;
  meanY /= n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    const dx = i - meanX;
    num += dx * ((history[i] as number) - meanY);
    den += dx * dx;
  }
  return den === 0 ? 0 : num / den;
}

export function createEtsTheta(config: EtsThetaConfig = {}): ClassicalForecaster {
  const alpha = Math.min(1, Math.max(1e-6, config.alpha ?? 0.5));
  return {
    name: 'ets_theta',
    version: '1.0.0',
    forecast(history: ReadonlyArray<number>, horizon: number): number[] {
      const n = history.length;
      const out: number[] = [];
      if (n === 0) {
        for (let h = 0; h < horizon; h++) out.push(0);
        return out;
      }
      if (n === 1) {
        const v = history[0] as number;
        for (let h = 0; h < horizon; h++) out.push(v);
        return out;
      }
      // Simple exponential smoothing for the level.
      let level = history[0] as number;
      for (let i = 1; i < n; i++) {
        level = alpha * (history[i] as number) + (1 - alpha) * level;
      }
      // Theta drift = half the OLS slope.
      const drift = olsSlope(history) / 2;
      for (let h = 1; h <= horizon; h++) {
        out.push(level + drift * h);
      }
      return out;
    },
  };
}
