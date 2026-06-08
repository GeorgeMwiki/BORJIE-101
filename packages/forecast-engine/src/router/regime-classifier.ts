/**
 * Data-regime classifier — pure, table-driven.
 *
 * Maps a `TimeSeries` + horizon to a `DataRegime` following the decision
 * matrix in the foundation-models dossier §4. The router then picks a
 * method by regime, NOT by leaderboard rank:
 *
 *   short / cold-start / intermittent  -> classical floor
 *   regular + longer horizon           -> TSFM provider (if available)
 *
 * Deterministic; no external deps.
 */

import type { TimeSeries } from '../types.js';

export type DataRegime =
  | 'short' // too little history to fit/learn
  | 'intermittent' // mostly zeros — Croston/TSB territory
  | 'regular-short-horizon' // enough history, near horizon -> classical
  | 'regular-long-horizon' // enough history, far horizon -> TSFM candidate
  | 'high-frequency'; // very long series, classical is hard to beat

export interface RegimeThresholds {
  /** Min observations to leave "short". Default 2 * max(seasonLength, 4). */
  readonly minRegularLength?: number;
  /** Fraction of zero values above which a series is "intermittent". Default 0.3. */
  readonly intermittentZeroFraction?: number;
  /** Horizon (steps) at/above which we consider it "long". Default 12. */
  readonly longHorizonSteps?: number;
  /** Length at/above which we treat as high-frequency. Default 2000. */
  readonly highFrequencyLength?: number;
}

export interface RegimeAssessment {
  readonly regime: DataRegime;
  readonly length: number;
  readonly zeroFraction: number;
  readonly seasonLength: number;
  /** True if the floor is the recommended primary method for this regime. */
  readonly preferClassical: boolean;
}

function zeroFraction(values: ReadonlyArray<number>): number {
  if (values.length === 0) return 1;
  let zeros = 0;
  for (const v of values) if (v === 0) zeros += 1;
  return zeros / values.length;
}

export function classifyRegime(
  series: TimeSeries,
  horizon: number,
  thresholds: RegimeThresholds = {},
): RegimeAssessment {
  const length = series.values.length;
  const seasonLength = Math.max(1, Math.floor(series.seasonLength ?? 1));
  const zf = zeroFraction(series.values);

  const minRegular =
    thresholds.minRegularLength ?? 2 * Math.max(seasonLength, 4);
  const intermittentFrac = thresholds.intermittentZeroFraction ?? 0.3;
  const longHorizon = thresholds.longHorizonSteps ?? 12;
  const highFreqLen = thresholds.highFrequencyLength ?? 2000;

  let regime: DataRegime;
  if (zf >= intermittentFrac) {
    regime = 'intermittent';
  } else if (length < minRegular) {
    regime = 'short';
  } else if (length >= highFreqLen) {
    regime = 'high-frequency';
  } else if (horizon >= longHorizon) {
    regime = 'regular-long-horizon';
  } else {
    regime = 'regular-short-horizon';
  }

  const preferClassical =
    regime === 'short' ||
    regime === 'intermittent' ||
    regime === 'regular-short-horizon' ||
    regime === 'high-frequency';

  return { regime, length, zeroFraction: zf, seasonLength, preferClassical };
}

/**
 * Recommended classical method for a regime — what the floor provider
 * should use as its sub-model.
 */
export function classicalMethodForRegime(
  regime: DataRegime,
): 'seasonal_naive' | 'ets_theta' | 'tsb' {
  switch (regime) {
    case 'intermittent':
      return 'tsb';
    case 'short':
      return 'seasonal_naive';
    case 'high-frequency':
      return 'seasonal_naive';
    case 'regular-short-horizon':
    case 'regular-long-horizon':
      return 'ets_theta';
    default: {
      const exhaustive: never = regime;
      return exhaustive;
    }
  }
}
