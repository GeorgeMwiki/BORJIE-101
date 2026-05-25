/**
 * Zero-trained baseline forecasters.
 *
 * Every benchmark needs a floor. If a TGN cannot beat last-value,
 * seasonal-naive, or "the mean of history", it does not earn its
 * inference cost. These baselines define that floor.
 *
 * All forecasters follow the same minimal interface so the backtest
 * loop can swap them without ceremony:
 *
 *   type Forecaster = (history: number[], horizon: number) => Forecast
 *
 * The returned Forecast carries:
 *   - point predictions, one per step
 *   - lower/upper bands at 80 percent and 95 percent (residual-based)
 *   - optional ensemble samples for CRPS scoring
 *
 * No external dependencies; every prediction is reproducible from the
 * history input alone.
 */

export interface ForecastOutput {
  readonly point: ReadonlyArray<number>;
  readonly lower80: ReadonlyArray<number>;
  readonly upper80: ReadonlyArray<number>;
  readonly lower95: ReadonlyArray<number>;
  readonly upper95: ReadonlyArray<number>;
  readonly samples: ReadonlyArray<ReadonlyArray<number>>;
}

export type Forecaster = (history: ReadonlyArray<number>, horizon: number) => ForecastOutput;

export interface BaselineOptions {
  /** Seasonality m for seasonal-naive (e.g. 7 = weekly on daily data). */
  readonly seasonality?: number;
  /** Number of ensemble samples to emit for CRPS scoring. */
  readonly sampleCount?: number;
  /** Random seed for reproducibility. */
  readonly seed?: number;
}

// ───────────────────────────────────────────────────────────────────────
// Deterministic PRNG — mulberry32. Pure, seedable, no Math.random calls
// anywhere in this file so benches are byte-reproducible.
// ───────────────────────────────────────────────────────────────────────

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box-Muller standard normal from two uniform draws. */
function randn(rng: () => number): number {
  const u1 = Math.max(rng(), Number.MIN_VALUE);
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

// ───────────────────────────────────────────────────────────────────────
// Residual scale — fit on in-sample one-step-ahead errors of the same
// baseline. Powers the prediction-interval band: a baseline that ignores
// uncertainty cannot be compared against a conformal forecaster.
// ───────────────────────────────────────────────────────────────────────

function residualStd(history: ReadonlyArray<number>, seasonality: number): number {
  if (history.length <= seasonality) {
    return 0;
  }
  let sum = 0;
  let sumSq = 0;
  let count = 0;
  for (let i = seasonality; i < history.length; i += 1) {
    const diff = (history[i] ?? 0) - (history[i - seasonality] ?? 0);
    sum += diff;
    sumSq += diff * diff;
    count += 1;
  }
  if (count <= 1) {
    return 0;
  }
  const mean = sum / count;
  const variance = (sumSq - count * mean * mean) / (count - 1);
  if (variance <= 0) {
    return 0;
  }
  return Math.sqrt(variance);
}

function buildBands(points: ReadonlyArray<number>, stdScale: number, rng: () => number, sampleCount: number):
  Omit<ForecastOutput, 'point'> {
  // Normal-approximation interval: width grows as sqrt(h) for a random
  // walk, otherwise constant. We assume independent residuals (the simple
  // case); a real model uses conformal calibration.
  const z80 = 1.2815515655446004;
  const z95 = 1.9599639845400545;
  const lower80: Array<number> = [];
  const upper80: Array<number> = [];
  const lower95: Array<number> = [];
  const upper95: Array<number> = [];
  const samples: Array<Array<number>> = [];
  for (let t = 0; t < points.length; t += 1) {
    const p = points[t] ?? 0;
    const horizonScale = Math.sqrt(t + 1);
    const stdAtH = stdScale * horizonScale;
    lower80.push(p - z80 * stdAtH);
    upper80.push(p + z80 * stdAtH);
    lower95.push(p - z95 * stdAtH);
    upper95.push(p + z95 * stdAtH);
    const stepSamples: Array<number> = [];
    for (let s = 0; s < sampleCount; s += 1) {
      stepSamples.push(p + randn(rng) * stdAtH);
    }
    samples.push(stepSamples);
  }
  return {
    lower80,
    upper80,
    lower95,
    upper95,
    samples,
  };
}

// ───────────────────────────────────────────────────────────────────────
// Last-value (naive).
// ───────────────────────────────────────────────────────────────────────

export function createLastValueBaseline(options: BaselineOptions = {}): Forecaster {
  const sampleCount = options.sampleCount ?? 200;
  const seed = options.seed ?? 1;
  return function lastValue(history, horizon) {
    if (history.length === 0) {
      throw new Error('baselines.lastValue: history must be non-empty');
    }
    const last = history[history.length - 1] ?? 0;
    const point: Array<number> = new Array(horizon).fill(last);
    const std = residualStd(history, 1);
    const rng = mulberry32(seed);
    const bands = buildBands(point, std, rng, sampleCount);
    return { point, ...bands };
  };
}

// ───────────────────────────────────────────────────────────────────────
// Mean baseline — flat mean of the training window.
// ───────────────────────────────────────────────────────────────────────

export function createMeanBaseline(options: BaselineOptions = {}): Forecaster {
  const sampleCount = options.sampleCount ?? 200;
  const seed = options.seed ?? 2;
  return function meanBaseline(history, horizon) {
    if (history.length === 0) {
      throw new Error('baselines.mean: history must be non-empty');
    }
    let sum = 0;
    for (const v of history) {
      sum += v;
    }
    const m = sum / history.length;
    const point: Array<number> = new Array(horizon).fill(m);
    // Empirical std around the mean.
    let sq = 0;
    for (const v of history) {
      const d = v - m;
      sq += d * d;
    }
    const std = history.length > 1 ? Math.sqrt(sq / (history.length - 1)) : 0;
    const rng = mulberry32(seed);
    const bands = buildBands(point, std, rng, sampleCount);
    return { point, ...bands };
  };
}

// ───────────────────────────────────────────────────────────────────────
// Seasonal-naive — repeat the value from m steps ago.
//
// For horizons longer than m, we cycle: prediction[t] = history[N - m + (t mod m)].
// This is the standard M-competition seasonal benchmark.
// ───────────────────────────────────────────────────────────────────────

export function createSeasonalNaiveBaseline(options: BaselineOptions = {}): Forecaster {
  const seasonality = options.seasonality ?? 7;
  const sampleCount = options.sampleCount ?? 200;
  const seed = options.seed ?? 3;
  if (!Number.isInteger(seasonality) || seasonality < 1) {
    throw new Error(`baselines.seasonalNaive: seasonality must be a positive integer, got ${seasonality}`);
  }
  return function seasonalNaive(history, horizon) {
    if (history.length < seasonality) {
      throw new Error(`baselines.seasonalNaive: history length ${history.length} < seasonality ${seasonality}`);
    }
    const n = history.length;
    const point: Array<number> = [];
    for (let t = 0; t < horizon; t += 1) {
      const idx = n - seasonality + (t % seasonality);
      point.push(history[idx] ?? 0);
    }
    const std = residualStd(history, seasonality);
    const rng = mulberry32(seed);
    const bands = buildBands(point, std, rng, sampleCount);
    return { point, ...bands };
  };
}

// ───────────────────────────────────────────────────────────────────────
// Registry — used by the CLI and report renderer.
// ───────────────────────────────────────────────────────────────────────

export interface NamedForecaster {
  readonly name: string;
  readonly forecaster: Forecaster;
}

export function defaultBaselines(seasonality: number, sampleCount = 200): ReadonlyArray<NamedForecaster> {
  return [
    { name: 'naive_last_value', forecaster: createLastValueBaseline({ sampleCount, seed: 11 }) },
    { name: 'mean_window', forecaster: createMeanBaseline({ sampleCount, seed: 12 }) },
    {
      name: `seasonal_naive_m${seasonality}`,
      forecaster: createSeasonalNaiveBaseline({ seasonality, sampleCount, seed: 13 }),
    },
  ];
}
