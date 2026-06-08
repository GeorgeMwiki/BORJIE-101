/**
 * SeasonalNaive — the mandatory accuracy floor.
 *
 * Forecast for step h = the observed value one full season ago:
 *   yhat_{T+h} = y_{T + h - m*ceil(h/m)}  (the last available
 *   same-phase observation), with m = season length.
 *
 * When m = 1 this degenerates to the plain Naive forecast (repeat the
 * last value). When history is shorter than one season it falls back
 * to the last observed value. Pure + deterministic.
 *
 * Reference: Hyndman & Athanasopoulos, FPP3 §5.2.
 */

import type { ClassicalForecaster } from './types.js';

export interface SeasonalNaiveConfig {
  /** Season length in steps. Default 1 (plain naive). */
  readonly seasonLength?: number;
}

export function createSeasonalNaive(
  config: SeasonalNaiveConfig = {},
): ClassicalForecaster {
  const m = Math.max(1, Math.floor(config.seasonLength ?? 1));
  return {
    name: 'seasonal_naive',
    version: '1.0.0',
    forecast(history: ReadonlyArray<number>, horizon: number): number[] {
      const n = history.length;
      const out: number[] = [];
      if (n === 0) {
        for (let h = 0; h < horizon; h++) out.push(0);
        return out;
      }
      const last = history[n - 1] as number;
      for (let h = 1; h <= horizon; h++) {
        if (n >= m) {
          // Phase-aligned seasonal naive: yhat_{T+h} = y_{T+h-m*ceil(h/m)},
          // i.e. the same-phase observation from the most recent complete
          // season. In 0-indexed terms: idx = n - m + ((h-1) mod m).
          const idx = n - m + ((h - 1) % m);
          out.push(idx >= 0 ? (history[idx] as number) : last);
        } else {
          out.push(last);
        }
      }
      return out;
    },
  };
}
