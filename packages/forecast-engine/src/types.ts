/**
 * `@borjie/forecast-engine` — core contracts (zod-validated).
 *
 * This file is the FORECAST PORT: the input `TimeSeries`, the
 * `ForecastRequest` (target + horizon + quantiles), and the
 * `ForecastResult` (point + prediction intervals + provenance /
 * evidence_id + baselineBeaten flag).
 *
 * Hard-rail alignment (CLAUDE.md):
 *  - Every forecast carries >=1 typed `evidence_id` describing
 *    {model, version, input-window, horizon, coverage, baselineBeaten}.
 *  - Money is currency-NEUTRAL here: a `ForecastResult` never embeds a
 *    formatted currency string. The optional `currencyCode` is metadata
 *    so a surface can later render via `formatCurrency(amount, code)`.
 *  - Types only + zod schemas; no runtime forecasting logic lives here.
 *
 * All structs are immutable (`readonly`).
 */

import { z } from 'zod';

// ──────────────────────────────────────────────────────────────────
// TimeSeries — the universal forecaster input.
// A regularly- or irregularly-spaced univariate series. Optional
// `timestamps` (ISO 8601) and `seasonLength` let seasonal models and
// the regime classifier reason about cadence; `values` is the spine.
// ──────────────────────────────────────────────────────────────────

export interface TimeSeries {
  /** Stable id for the series (entity + metric), e.g. 'site:42:rom_tonnes'. */
  readonly seriesId: string;
  /** Observed values in chronological order (oldest first). */
  readonly values: ReadonlyArray<number>;
  /** Optional ISO 8601 timestamps aligned 1:1 with `values`. */
  readonly timestamps?: ReadonlyArray<string>;
  /**
   * Season length in steps (e.g. 7 for daily-with-weekly-cycle,
   * 12 for monthly-with-yearly-cycle). 1 = non-seasonal.
   */
  readonly seasonLength?: number;
  /** Optional ISO-4217 code so a downstream surface can format money. */
  readonly currencyCode?: string;
}

export const TimeSeriesSchema: z.ZodType<TimeSeries> = z
  .object({
    seriesId: z.string().min(1),
    values: z.array(z.number().finite()).min(1),
    timestamps: z.array(z.string().min(1)).optional(),
    seasonLength: z.number().int().min(1).optional(),
    currencyCode: z.string().length(3).optional(),
  })
  .superRefine((s, ctx) => {
    if (s.timestamps && s.timestamps.length !== s.values.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'timestamps length must equal values length',
        path: ['timestamps'],
      });
    }
  }) as unknown as z.ZodType<TimeSeries>;

// ──────────────────────────────────────────────────────────────────
// Quantile levels — probability mass cut-points, in (0,1).
// p50 (median) is always implied; callers ask for tail quantiles such
// as 0.1 / 0.9 (an 80% interval) or 0.05 / 0.95 (a 90% interval).
// ──────────────────────────────────────────────────────────────────

export const QuantileLevelSchema = z.number().gt(0).lt(1);

export const DEFAULT_QUANTILES: ReadonlyArray<number> = [0.1, 0.5, 0.9];

// ──────────────────────────────────────────────────────────────────
// ForecastRequest — what to forecast and how.
// ──────────────────────────────────────────────────────────────────

export interface ForecastRequest {
  /** Tenant scope; `null` for global (tenant_id = NULL) ground-truth series. */
  readonly tenantId: string | null;
  /** Logical forecast target id (see targets/registry.ts), e.g. 'mining.A1.price'. */
  readonly target: string;
  /** The history to extrapolate from. */
  readonly series: TimeSeries;
  /** Steps ahead to forecast (>=1). */
  readonly horizon: number;
  /** Quantile levels to emit. Defaults to DEFAULT_QUANTILES. */
  readonly quantiles?: ReadonlyArray<number>;
  /**
   * Target coverage for the conformal interval (1 - alpha).
   * Default 0.9. Drives the calibrated interval width.
   */
  readonly targetCoverage?: number;
}

export const ForecastRequestSchema: z.ZodType<ForecastRequest> = z.object({
  tenantId: z.string().min(1).nullable(),
  target: z.string().min(1),
  series: TimeSeriesSchema,
  horizon: z.number().int().min(1).max(3650),
  quantiles: z.array(QuantileLevelSchema).min(1).optional(),
  targetCoverage: z.number().gt(0).lt(1).optional(),
}) as unknown as z.ZodType<ForecastRequest>;

// ──────────────────────────────────────────────────────────────────
// QuantileForecast — one horizon step: a point (p50) plus the quantile
// map. Quantile keys are stringified levels ('0.1', '0.5', '0.9').
// ──────────────────────────────────────────────────────────────────

export interface QuantileForecast {
  /** 1-based step ahead (1 = next period). */
  readonly step: number;
  /** Point forecast (the p50 / median). */
  readonly point: number;
  /** Map of quantile-level → value, e.g. { '0.1': .., '0.9': .. }. */
  readonly quantiles: Readonly<Record<string, number>>;
}

export const QuantileForecastSchema: z.ZodType<QuantileForecast> = z.object({
  step: z.number().int().min(1),
  point: z.number(),
  quantiles: z.record(z.string(), z.number()),
}) as unknown as z.ZodType<QuantileForecast>;

// ──────────────────────────────────────────────────────────────────
// PredictionInterval — a CALIBRATED lower/upper band for one step
// (the output of the conformal wrapper, NOT a raw model quantile).
// ──────────────────────────────────────────────────────────────────

export interface PredictionInterval {
  readonly step: number;
  readonly point: number;
  readonly lower: number;
  readonly upper: number;
  /** Miscoverage rate alpha; nominal coverage = 1 - alpha. */
  readonly alpha: number;
}

export const PredictionIntervalSchema: z.ZodType<PredictionInterval> = z.object({
  step: z.number().int().min(1),
  point: z.number(),
  lower: z.number(),
  upper: z.number(),
  alpha: z.number().gt(0).lt(1),
}) as unknown as z.ZodType<PredictionInterval>;

// ──────────────────────────────────────────────────────────────────
// EvidenceId — typed provenance. The Auditor rejects a forecast whose
// `evidenceIds` array is empty. Each carries the full claim:
// {model, version, input-window, horizon, coverage, baselineBeaten}.
// ──────────────────────────────────────────────────────────────────

export interface EvidenceId {
  /** Stable evidence identifier (hashable, citeable). */
  readonly id: string;
  /** Provider / method that produced the forecast, e.g. 'classical:seasonal_naive'. */
  readonly model: string;
  /** Provider model version string. */
  readonly version: string;
  /** Number of input observations the forecast was conditioned on. */
  readonly inputWindow: number;
  /** Horizon (steps) the forecast covers. */
  readonly horizon: number;
  /** Nominal conformal coverage (1 - alpha). */
  readonly coverage: number;
  /** True iff this model beat the classical floor on held-out backtest. */
  readonly baselineBeaten: boolean;
}

export const EvidenceIdSchema: z.ZodType<EvidenceId> = z.object({
  id: z.string().min(1),
  model: z.string().min(1),
  version: z.string().min(1),
  inputWindow: z.number().int().min(0),
  horizon: z.number().int().min(1),
  coverage: z.number().gt(0).lt(1),
  baselineBeaten: z.boolean(),
}) as unknown as z.ZodType<EvidenceId>;

// ──────────────────────────────────────────────────────────────────
// ForecastResult — the engine's deliverable for a request.
// ──────────────────────────────────────────────────────────────────

export interface ForecastResult {
  /** Deterministic id derived from {tenant, target, series, horizon}. */
  readonly forecastId: string;
  readonly tenantId: string | null;
  readonly target: string;
  readonly horizon: number;
  /** Point forecasts per step (p50). */
  readonly points: ReadonlyArray<QuantileForecast>;
  /** CALIBRATED prediction intervals per step (post-conformal). */
  readonly intervals: ReadonlyArray<PredictionInterval>;
  /** The provider/method that produced the chosen forecast. */
  readonly model: string;
  readonly modelVersion: string;
  /** True iff the chosen model beat the classical floor on backtest. */
  readonly baselineBeaten: boolean;
  /** Achieved/nominal conformal coverage (1 - alpha). */
  readonly conformalCoverage: number;
  /** >=1 typed evidence id — the Auditor rejects empty chains. */
  readonly evidenceIds: ReadonlyArray<EvidenceId>;
  /** Optional ISO-4217 code (metadata only; surfaces format via formatCurrency). */
  readonly currencyCode?: string;
}

export const ForecastResultSchema: z.ZodType<ForecastResult> = z.object({
  forecastId: z.string().min(1),
  tenantId: z.string().min(1).nullable(),
  target: z.string().min(1),
  horizon: z.number().int().min(1),
  points: z.array(QuantileForecastSchema).min(1),
  intervals: z.array(PredictionIntervalSchema).min(1),
  model: z.string().min(1),
  modelVersion: z.string().min(1),
  baselineBeaten: z.boolean(),
  conformalCoverage: z.number().gt(0).lt(1),
  evidenceIds: z.array(EvidenceIdSchema).min(1),
  currencyCode: z.string().length(3).optional(),
}) as unknown as z.ZodType<ForecastResult>;

// ──────────────────────────────────────────────────────────────────
// RawForecast — what a provider emits BEFORE conformal calibration.
// Raw quantiles are NEVER surfaced; the conformal wrapper turns them
// into a `PredictionInterval`.
// ──────────────────────────────────────────────────────────────────

export interface RawForecast {
  readonly model: string;
  readonly modelVersion: string;
  /** Raw per-step quantile forecasts (uncalibrated). */
  readonly steps: ReadonlyArray<QuantileForecast>;
  /** Provider latency in milliseconds (for cost/health telemetry). */
  readonly latencyMs: number;
}

export const RawForecastSchema: z.ZodType<RawForecast> = z.object({
  model: z.string().min(1),
  modelVersion: z.string().min(1),
  steps: z.array(QuantileForecastSchema).min(1),
  latencyMs: z.number().min(0),
}) as unknown as z.ZodType<RawForecast>;
