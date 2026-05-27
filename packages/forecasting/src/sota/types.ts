/**
 * SOTA time-series forecasting — public types.
 *
 * The SOTA layer composes foundation-model adapters (TimeGPT,
 * Chronos, MOIRAI, Prophet, ARIMA, N-BEATS/N-HiTS) with pure-TS
 * naive baselines and a weighted ensemble. Every adapter returns
 * the same `ForecastResult` shape so callers can swap and combine
 * freely.
 *
 * Pure contracts only — no runtime.
 *
 * @module @borjie/forecasting/sota/types
 */

import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────
// Time-series primitive
// ─────────────────────────────────────────────────────────────────────

/** Sampling frequency of a series. */
export const TS_FREQUENCIES = [
  'hourly',
  'daily',
  'weekly',
  'monthly',
  'quarterly',
  'yearly',
] as const;

export type TsFrequency = (typeof TS_FREQUENCIES)[number];

/** A single observation in a univariate series. */
export interface TimePoint {
  readonly t: string;
  readonly y: number;
}

export const timePointSchema: z.ZodType<TimePoint> = z.object({
  t: z.string().min(1),
  y: z.number().finite(),
});

/** A named univariate series. */
export interface TimeSeries {
  readonly id: string;
  readonly frequency: TsFrequency;
  readonly points: ReadonlyArray<TimePoint>;
  readonly unit?: string;
  readonly jurisdiction?: string;
}

export const timeSeriesSchema = z.object({
  id: z.string().min(1),
  frequency: z.enum(TS_FREQUENCIES),
  points: z.array(timePointSchema),
  unit: z.string().optional(),
  jurisdiction: z.string().optional(),
});

// ─────────────────────────────────────────────────────────────────────
// Forecast result
// ─────────────────────────────────────────────────────────────────────

/** Forecast horizon = number of frequency-steps ahead. */
export interface ForecastHorizon {
  readonly steps: number;
}

export const forecastHorizonSchema: z.ZodType<ForecastHorizon> = z.object({
  steps: z.number().int().positive().max(1000),
});

/** Per-step interval bound (used inside ForecastResult). */
export interface IntervalBound {
  readonly step: number;
  readonly lower: number;
  readonly upper: number;
}

export const intervalBoundSchema: z.ZodType<IntervalBound> = z.object({
  step: z.number().int().positive(),
  lower: z.number().finite(),
  upper: z.number().finite(),
});

/** SOTA model identifiers. */
export const SOTA_MODELS = [
  'timegpt',
  'chronos',
  'moirai',
  'prophet',
  'arima',
  'nbeats',
  'naive-last',
  'naive-seasonal',
  'naive-mean',
  'ensemble',
] as const;

export type SotaModel = (typeof SOTA_MODELS)[number];
export const sotaModelSchema = z.enum(SOTA_MODELS);

/** Forecast targets the mining domain forecasts. */
export const FORECAST_TARGETS = [
  'gold_price',
  'production_volume',
  'royalty',
  'demand',
  'workforce',
  'fuel',
] as const;

export type ForecastTarget = (typeof FORECAST_TARGETS)[number];
export const forecastTargetSchema = z.enum(FORECAST_TARGETS);

/**
 * Backtest metrics shape persisted alongside a forecast run. Every
 * field is optional so adapters that cannot cheaply compute a metric
 * may omit it.
 */
export interface BacktestMetrics {
  readonly mae?: number;
  readonly mape?: number;
  readonly smape?: number;
  readonly rmse?: number;
  readonly mase?: number;
  readonly owa?: number;
  readonly wql?: number;
}

export const backtestMetricsSchema = z.object({
  mae: z.number().optional(),
  mape: z.number().optional(),
  smape: z.number().optional(),
  rmse: z.number().optional(),
  mase: z.number().optional(),
  owa: z.number().optional(),
  wql: z.number().optional(),
});

/**
 * The canonical forecast result. Every SOTA adapter and the
 * ensemble return this shape.
 *
 * Invariants enforced at parse time and tested in port-contract:
 *  - `point.length === horizon.steps`
 *  - `intervals_80.length === horizon.steps`
 *  - `intervals_95.length === horizon.steps`
 *  - per step: lower_95 <= lower_80 <= point <= upper_80 <= upper_95
 */
export interface ForecastResult {
  readonly seriesId: string;
  readonly model: SotaModel;
  readonly modelVersion: string;
  readonly horizon: ForecastHorizon;
  readonly point: ReadonlyArray<number>;
  readonly intervals_80: ReadonlyArray<IntervalBound>;
  readonly intervals_95: ReadonlyArray<IntervalBound>;
  readonly generatedAtISO: string;
  readonly metrics?: BacktestMetrics;
  readonly meta?: Readonly<Record<string, string | number | boolean>>;
}

export const forecastResultSchema = z.object({
  seriesId: z.string().min(1),
  model: sotaModelSchema,
  modelVersion: z.string().min(1),
  horizon: forecastHorizonSchema,
  point: z.array(z.number().finite()),
  intervals_80: z.array(intervalBoundSchema),
  intervals_95: z.array(intervalBoundSchema),
  generatedAtISO: z.string().min(1),
  metrics: backtestMetricsSchema.optional(),
  meta: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
});

/** Options forwarded to a forecaster. Always optional. */
export interface ForecastOptions {
  /** Seasonal period in steps (model hint). */
  readonly seasonality?: number;
  /** Whether to ask the adapter to return walk-forward metrics. */
  readonly computeMetrics?: boolean;
  /** Model-specific opaque options. */
  readonly extra?: Readonly<Record<string, unknown>>;
}

// ─────────────────────────────────────────────────────────────────────
// Backtest result shape
// ─────────────────────────────────────────────────────────────────────

export interface BacktestSplit {
  readonly index: number;
  readonly trainSize: number;
  readonly testSize: number;
  /** Per-step error (y - ŷ) for this split. */
  readonly residuals: ReadonlyArray<number>;
}

export interface Backtest {
  readonly seriesId: string;
  readonly model: SotaModel;
  readonly splits: ReadonlyArray<BacktestSplit>;
  readonly metrics: BacktestMetrics;
}

// ─────────────────────────────────────────────────────────────────────
// Port shape
// ─────────────────────────────────────────────────────────────────────

/** Every SOTA adapter implements this interface. */
export interface SotaForecastingPort {
  readonly model: SotaModel;
  readonly modelVersion: string;
  predict(args: {
    readonly series: TimeSeries;
    readonly horizon: ForecastHorizon;
    readonly opts?: ForecastOptions;
  }): Promise<ForecastResult>;
}

/** Injected HTTP fetcher — production binds globalThis.fetch. */
export type Fetcher = typeof fetch;

/** Injected sidecar port — production binds a long-running Python proc. */
export interface SidecarPort {
  invoke(args: {
    readonly model: 'prophet' | 'arima' | 'nbeats';
    readonly payload: Readonly<Record<string, unknown>>;
  }): Promise<Readonly<Record<string, unknown>>>;
}

// ─────────────────────────────────────────────────────────────────────
// Persisted forecast run (mirrors migration 0067 forecast_runs)
// ─────────────────────────────────────────────────────────────────────

export interface ForecastRun {
  readonly id: string;
  readonly tenantId: string;
  readonly target: ForecastTarget;
  readonly horizon: number;
  readonly model: string;
  readonly pointForecast: ReadonlyArray<number>;
  readonly intervals80: ReadonlyArray<IntervalBound>;
  readonly intervals95: ReadonlyArray<IntervalBound>;
  readonly metrics: BacktestMetrics;
  readonly ranAt: Date;
  readonly prevHash: string;
  readonly auditHash: string;
}

export interface ForecastRunInsert {
  readonly tenantId: string;
  readonly target: ForecastTarget;
  readonly horizon: number;
  readonly model: string;
  readonly pointForecast: ReadonlyArray<number>;
  readonly intervals80: ReadonlyArray<IntervalBound>;
  readonly intervals95: ReadonlyArray<IntervalBound>;
  readonly metrics: BacktestMetrics;
}

export interface ForecastRunFilter {
  readonly target?: ForecastTarget;
  readonly model?: string;
}

export interface ForecastRunRepository {
  insert(input: ForecastRunInsert): Promise<ForecastRun>;
  findById(tenantId: string, id: string): Promise<ForecastRun | null>;
  listForTenant(
    tenantId: string,
    filter?: ForecastRunFilter,
  ): Promise<ReadonlyArray<ForecastRun>>;
}

// ─────────────────────────────────────────────────────────────────────
// Mining-domain wrapper output
// ─────────────────────────────────────────────────────────────────────

export interface MiningForecastNarrative {
  readonly headline: string;
  readonly detail: string;
  readonly severity: 'info' | 'low' | 'medium' | 'high' | 'critical';
}

export interface MiningForecastResult {
  readonly target: ForecastTarget;
  readonly forecast: ForecastResult;
  readonly narrative: MiningForecastNarrative;
  readonly sources: ReadonlyArray<string>;
}
