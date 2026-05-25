/**
 * Foundation-model adapter ports.
 *
 * Each adapter is a `ForecastingPort` that delegates the actual model
 * call to a network endpoint or a local LLM brain. The factories take
 * the minimum credentials/endpoint needed; tests pass a deterministic
 * mock through `network` so we never make real calls.
 *
 * No model weights ship in this TS package — we ship the contract.
 */

import type {
  ForecastingPort,
  TimeSeriesForecast,
  TimeSeries,
  Horizon,
  ForecastingOptions,
  ForecastInterval,
} from '../types.js';
import {
  assertValidSeries,
  buildForecastIntervals,
  futureTimestamps,
  mean,
  stdDev,
  values,
} from '../util/series.js';

// ─────────────────────────────────────────────────────────────────────
// Shared network contract
// ─────────────────────────────────────────────────────────────────────

/** Shape every foundation-model network call must return. The adapter
 *  itself ensures lengths match, builds future timestamps, and wraps
 *  the response into a `TimeSeriesForecast`. */
export interface FoundationModelResponse {
  /** Point predictions for steps 1..horizon. */
  readonly points: ReadonlyArray<number>;
  /** Lower bounds for steps 1..horizon. */
  readonly lower: ReadonlyArray<number>;
  /** Upper bounds for steps 1..horizon. */
  readonly upper: ReadonlyArray<number>;
  /** Adapter-reported model version. */
  readonly modelVersion: string;
  /** Optional metadata bag. */
  readonly meta?: Readonly<Record<string, string | number | boolean>>;
}

export interface FoundationModelCallArgs {
  readonly series: TimeSeries;
  readonly horizon: Horizon;
  readonly opts?: ForecastingOptions;
}

export type FoundationModelNetwork = (
  args: FoundationModelCallArgs,
) => Promise<FoundationModelResponse>;

function assertResponseShape(
  resp: FoundationModelResponse,
  horizon: Horizon,
): void {
  if (resp.points.length !== horizon.steps) {
    throw new RangeError(
      `foundation-model: expected ${horizon.steps} point predictions, got ${resp.points.length}`,
    );
  }
  if (resp.lower.length !== horizon.steps || resp.upper.length !== horizon.steps) {
    throw new RangeError('foundation-model: lower/upper length mismatch');
  }
  for (const v of [...resp.points, ...resp.lower, ...resp.upper]) {
    if (!Number.isFinite(v)) {
      throw new RangeError('foundation-model: non-finite value in response');
    }
  }
  for (let i = 0; i < horizon.steps; i += 1) {
    if (resp.lower[i]! > resp.upper[i]!) {
      throw new RangeError(
        `foundation-model: lower > upper at step ${i + 1}`,
      );
    }
  }
}

function intervalsFromResponse(args: {
  readonly series: TimeSeries;
  readonly horizon: Horizon;
  readonly resp: FoundationModelResponse;
  readonly alpha: number;
}): ReadonlyArray<ForecastInterval> {
  const { series, horizon, resp, alpha } = args;
  const future = futureTimestamps(series, horizon.steps);
  return buildForecastIntervals({
    future,
    points: resp.points,
    lower:  resp.lower,
    upper:  resp.upper,
    alpha,
    conformal: false,
  });
}

// ─────────────────────────────────────────────────────────────────────
// Deterministic mock helper — used by tests and as the default when no
// network is provided. Predicts the trailing mean ± k * stddev.
// ─────────────────────────────────────────────────────────────────────

/** Build a deterministic mock that returns trailing-mean predictions
 *  with ±k·σ intervals. Lets you wire an adapter in tests without
 *  pretending to call a real API. */
export function createDeterministicMockNetwork(
  modelVersion: string,
  intervalZ: number = 1.645,
): FoundationModelNetwork {
  return async ({ series, horizon }) => {
    assertValidSeries(series);
    const ys = values(series);
    const mu = ys.length > 0 ? mean(ys) : 0;
    const sigma = ys.length > 1 ? stdDev(ys) : 0;
    const halfWidth = intervalZ * sigma;
    const points = new Array(horizon.steps).fill(mu) as number[];
    const lower  = points.map((p) => p - halfWidth);
    const upper  = points.map((p) => p + halfWidth);
    return Object.freeze({
      points: Object.freeze(points),
      lower:  Object.freeze(lower),
      upper:  Object.freeze(upper),
      modelVersion,
      meta:   Object.freeze({ mu, sigma, halfWidth }),
    });
  };
}

// ─────────────────────────────────────────────────────────────────────
// Chronos adapter (Amazon, Apache 2.0)
// ─────────────────────────────────────────────────────────────────────

export interface ChronosAdapterOptions {
  /** HTTPS endpoint of the Chronos / Chronos-Bolt inference service. */
  readonly endpoint: string;
  /** Optional bearer/IAM token. Passed through to the network. */
  readonly token?: string;
  /** Variant: 'chronos' (T5) or 'chronos-bolt' (faster). */
  readonly variant?: 'chronos' | 'chronos-bolt';
  /** Override the network for tests. If absent, the adapter raises
   *  at predict-time — no implicit network in this package. */
  readonly network?: FoundationModelNetwork;
}

export function createChronosAdapter(
  opts: ChronosAdapterOptions,
): ForecastingPort {
  if (!opts.endpoint && !opts.network) {
    throw new Error('chronos-adapter: endpoint or network must be provided');
  }
  const net =
    opts.network ??
    (async () => {
      throw new Error(
        'chronos-adapter: no `network` provided — wire an HTTP client at the app boundary',
      );
    });
  const variant = opts.variant ?? 'chronos';

  return {
    kind: 'chronos',
    async predict(args): Promise<TimeSeriesForecast> {
      const { series, horizon } = args;
      assertValidSeries(series);
      const alpha = args.opts?.alpha ?? 0.1;
      const resp = await net(args);
      assertResponseShape(resp, horizon);
      const points = intervalsFromResponse({ series, horizon, resp, alpha });
      return Object.freeze({
        seriesId:     series.id,
        modelKind:    'chronos',
        modelVersion: resp.modelVersion,
        horizon,
        points,
        generatedAt:  new Date().toISOString(),
        meta: {
          variant,
          endpoint: opts.endpoint,
          ...(resp.meta ?? {}),
        },
      });
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// TimesFM adapter (Google, Apache 2.0)
// ─────────────────────────────────────────────────────────────────────

export interface TimesFMAdapterOptions {
  /** GCP project ID. */
  readonly projectId: string;
  /** API key or service-account token. */
  readonly apiKey: string;
  /** Optional explicit endpoint override. */
  readonly endpoint?: string;
  readonly network?: FoundationModelNetwork;
}

export function createTimesFMAdapter(
  opts: TimesFMAdapterOptions,
): ForecastingPort {
  if (!opts.projectId || !opts.apiKey) {
    throw new Error('timesfm-adapter: projectId and apiKey are required');
  }
  const net =
    opts.network ??
    (async () => {
      throw new Error(
        'timesfm-adapter: no `network` provided — wire a GCP/Vertex client at the app boundary',
      );
    });

  return {
    kind: 'timesfm',
    async predict(args): Promise<TimeSeriesForecast> {
      const { series, horizon } = args;
      assertValidSeries(series);
      const alpha = args.opts?.alpha ?? 0.1;
      const resp = await net(args);
      assertResponseShape(resp, horizon);
      const points = intervalsFromResponse({ series, horizon, resp, alpha });
      return Object.freeze({
        seriesId:     series.id,
        modelKind:    'timesfm',
        modelVersion: resp.modelVersion,
        horizon,
        points,
        generatedAt:  new Date().toISOString(),
        meta: {
          projectId: opts.projectId,
          ...(resp.meta ?? {}),
        },
      });
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// TimeGPT adapter (Nixtla, commercial API)
// ─────────────────────────────────────────────────────────────────────

export interface TimeGPTAdapterOptions {
  /** Nixtla API key. */
  readonly apiKey: string;
  /** Optional explicit endpoint override; defaults to public API. */
  readonly endpoint?: string;
  readonly network?: FoundationModelNetwork;
}

export function createTimeGPTAdapter(
  opts: TimeGPTAdapterOptions,
): ForecastingPort {
  if (!opts.apiKey) {
    throw new Error('timegpt-adapter: apiKey is required');
  }
  const net =
    opts.network ??
    (async () => {
      throw new Error(
        'timegpt-adapter: no `network` provided — wire fetch at the app boundary',
      );
    });

  return {
    kind: 'timegpt',
    async predict(args): Promise<TimeSeriesForecast> {
      const { series, horizon } = args;
      assertValidSeries(series);
      const alpha = args.opts?.alpha ?? 0.1;
      const resp = await net(args);
      assertResponseShape(resp, horizon);
      const points = intervalsFromResponse({ series, horizon, resp, alpha });
      return Object.freeze({
        seriesId:     series.id,
        modelKind:    'timegpt',
        modelVersion: resp.modelVersion,
        horizon,
        points,
        generatedAt:  new Date().toISOString(),
        meta: { ...(resp.meta ?? {}) },
      });
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// LLM zero-shot adapter — uses an injected multi-LLM brain.
// ─────────────────────────────────────────────────────────────────────

/** Minimal contract the multi-LLM brain exposes. The forecaster never
 *  imports the brain package directly to avoid a circular dependency. */
export interface LLMBrain {
  /** Synthesize a JSON forecast block for the given prompt. The brain
   *  is expected to enforce schema validation and consensus across
   *  models — this adapter trusts the output shape. */
  synthesize(args: {
    readonly prompt: string;
    readonly responseSchema: 'forecast-json';
  }): Promise<string>;
}

export interface LLMForecasterOptions {
  readonly brain: LLMBrain;
  /** Optional system prompt prefix. */
  readonly systemPrompt?: string;
  /** Max number of trailing observations to include in the prompt. */
  readonly maxHistory?: number;
}

function safeParseLLMResponse(
  raw: string,
  horizon: Horizon,
): { points: number[]; lower: number[]; upper: number[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('llm-forecaster: brain response is not valid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('llm-forecaster: brain response is not an object');
  }
  const obj = parsed as Record<string, unknown>;
  const numArray = (v: unknown, label: string): number[] => {
    if (!Array.isArray(v)) {
      throw new Error(`llm-forecaster: ${label} is not an array`);
    }
    return v.map((x, i) => {
      if (typeof x !== 'number' || !Number.isFinite(x)) {
        throw new Error(`llm-forecaster: ${label}[${i}] is not a finite number`);
      }
      return x;
    });
  };
  const points = numArray(obj['points'], 'points');
  const lower  = numArray(obj['lower'],  'lower');
  const upper  = numArray(obj['upper'],  'upper');
  if (points.length !== horizon.steps) {
    throw new Error(
      `llm-forecaster: expected ${horizon.steps} points, got ${points.length}`,
    );
  }
  return { points, lower, upper };
}

export function createLLMForecaster(
  opts: LLMForecasterOptions,
): ForecastingPort {
  const maxHistory = opts.maxHistory ?? 100;
  const systemPrompt =
    opts.systemPrompt ??
    'You are a zero-shot time-series forecaster. Respond ONLY with JSON: {"points":[],"lower":[],"upper":[]}.';

  return {
    kind: 'llm-zero-shot',
    async predict(args): Promise<TimeSeriesForecast> {
      const { series, horizon } = args;
      assertValidSeries(series);
      if (series.points.length === 0) {
        throw new RangeError('llm-forecaster: cannot forecast on empty series');
      }
      const alpha = args.opts?.alpha ?? 0.1;
      const history = series.points.slice(-maxHistory);
      const prompt =
        systemPrompt +
        '\n\n' +
        'Series ID: ' + series.id + '\n' +
        'Frequency: ' + series.frequency + '\n' +
        'History (most recent ' + history.length + '): ' +
          JSON.stringify(history.map((p) => p.y)) + '\n' +
        'Predict the next ' + horizon.steps + ' steps. ' +
        'Return JSON: {"points":[...], "lower":[...], "upper":[...]}.';
      const raw = await opts.brain.synthesize({
        prompt,
        responseSchema: 'forecast-json',
      });
      const parsed = safeParseLLMResponse(raw, horizon);
      const future = futureTimestamps(series, horizon.steps);
      const points = buildForecastIntervals({
        future,
        points: parsed.points,
        lower:  parsed.lower,
        upper:  parsed.upper,
        alpha,
        conformal: false,
      });
      return Object.freeze({
        seriesId:     series.id,
        modelKind:    'llm-zero-shot',
        modelVersion: 'llm-zero-shot-1',
        horizon,
        points,
        generatedAt:  new Date().toISOString(),
        meta: { historyPoints: history.length },
      });
    },
  };
}
