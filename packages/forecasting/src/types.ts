/**
 * Forecasting public types.
 *
 * The forecasting package produces calibrated risk + opportunity
 * predictions for every node in the property graph. Three layers
 * stack, each stronger than the last:
 *
 *   1. Local gradient-boosted baselines on tabular per-entity features
 *      — fast, cheap, the floor.
 *   2. Temporal Graph Network (TGN) that consumes the per-org subgraph
 *      — captures vendor ↔ tenant ↔ unit interactions no tabular
 *      model sees. Per-org; never touches another tenant's data.
 *   3. Geometric foundation model fine-tuned on the DP-aggregated
 *      PLATFORM graph — produces sector-level forecasts no individual
 *      operator could produce alone (Borjie's moat).
 *
 * Every forecast ships with a conformal-prediction interval, not a
 * point estimate. "70% occupancy next quarter" with no interval is
 * a lie; "68-72% at 90% confidence" is a usable forecast.
 *
 * This file contains ONLY types — pure contracts. No runtime.
 */

import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────
// Risk kinds — the canonical set. New risk kinds go here first,
// guarded by an exhaustive switch downstream so unknown kinds become
// a typecheck error, not a silent miss.
// ─────────────────────────────────────────────────────────────────────

export const RISK_KINDS = [
  'arrears_risk',           // tenant will be 30+ days late
  'churn_risk',             // tenant will not renew
  'incident_risk',          // unit will raise an unresolved maintenance escalation
  'vendor_decay',           // vendor performance is trending down across tenants
  'renewal_opportunity',    // above-market rent potential at next renewal
  'compliance_drift',       // policy/statute cadence will be breached
  'void_risk',              // unit will sit vacant beyond market average
  'repair_recurrence',      // same incident type likely to re-open
  'payment_method_decay',   // card will expire / mandate will fail
  'litigation_exposure',    // case is likely to escalate to tribunal
] as const;

export type RiskKind = (typeof RISK_KINDS)[number];

export const RiskKindSchema = z.enum(RISK_KINDS);

// ─────────────────────────────────────────────────────────────────────
// Scope — every forecast is bound to a specific node in the graph AND
// a specific tenant. Platform-wide aggregates are a separate type
// (PlatformForecast) so cross-tenant leakage is impossible at the
// type level.
// ─────────────────────────────────────────────────────────────────────

export interface ForecastScope {
  readonly tenantId: string;
  readonly nodeLabel: string;     // Neo4j label, e.g. 'Unit', 'Tenant'
  readonly nodeId: string;        // graph node ID (usually a UUID)
  readonly horizonDays: number;   // e.g. 28, 60, 90
}

export const ForecastScopeSchema = z.object({
  tenantId: z.string().min(1),
  nodeLabel: z.string().min(1),
  nodeId: z.string().min(1),
  horizonDays: z.number().int().min(1).max(365),
});

// ─────────────────────────────────────────────────────────────────────
// Conformal interval — the core deliverable, not just a point
// estimate. Built via inductive conformal prediction (ICP) on a
// calibration fold, so the coverage guarantee is frequentist and
// assumption-light.
// ─────────────────────────────────────────────────────────────────────

export interface ConformalInterval {
  /** Mean / MAP prediction. In [0,1] for probability forecasts,
   *  or in domain units for regression (e.g. minor-currency-units). */
  readonly point: number;
  /** Lower bound of the prediction interval. */
  readonly lower: number;
  /** Upper bound of the prediction interval. */
  readonly upper: number;
  /** Target miscoverage rate alpha; coverage = 1 - alpha.
   *  Default alpha=0.1 gives a 90% interval. */
  readonly alpha: number;
}

export const ConformalIntervalSchema: z.ZodType<ConformalInterval> = z.object({
  point:  z.number(),
  lower:  z.number(),
  upper:  z.number(),
  alpha:  z.number().min(0.001).max(0.5),
});

// ─────────────────────────────────────────────────────────────────────
// Feature vector — the input to any per-node forecast. Features come
// from three sources:
//   - `tabular`: node-local attributes (age of unit, payment history,
//     credit rating). Pulled from Postgres read replicas.
//   - `graph`: k-hop neighbourhood aggregates (vendor reliability,
//     cohort sentiment). Pulled from Memgraph/Neo4j via graph-sync.
//   - `temporal`: sequence of the node's events over the last 365d,
//     binned into a fixed-length tensor. Drives the TGN.
// ─────────────────────────────────────────────────────────────────────

export interface FeatureVector {
  readonly scope: ForecastScope;
  readonly tabular: Readonly<Record<string, number>>;
  readonly graph:   Readonly<Record<string, number>>;
  /** Shape: [timesteps × channels]. Row-major, float32-equivalent. */
  readonly temporal: ReadonlyArray<ReadonlyArray<number>>;
  readonly generatedAt: string;       // ISO timestamp
}

// ─────────────────────────────────────────────────────────────────────
// Forecast — the output. Every forecast carries:
//   - A point + interval (via conformal prediction)
//   - A set of top SHAP-like driver attributions so the head of
//     estates can see WHY, not just how much.
//   - A stable forecastId so the exact same prediction can be
//     retrieved, audited, and re-scored later.
//   - The model version that produced it (so we can differentiate
//     stale vs. fresh predictions in dashboards).
// ─────────────────────────────────────────────────────────────────────

export interface ForecastDriver {
  /** Feature name, e.g. 'graph.vendor_reopen_rate_60d'. */
  readonly name: string;
  /** Signed contribution to the point prediction. */
  readonly contribution: number;
  /** Human-readable explanation produced by the driver module. */
  readonly narrative: string;
}

export interface Forecast {
  readonly forecastId: string;
  readonly kind: RiskKind;
  readonly scope: ForecastScope;
  readonly interval: ConformalInterval;
  readonly drivers: ReadonlyArray<ForecastDriver>;
  readonly modelVersion: string;      // e.g. 'tgn-org-2026.04.22-r3'
  readonly generatedAt: string;
  /** Link back to the FeatureVector used — enables audit + rerun. */
  readonly featureFingerprint: string;
}

export const ForecastSchema: z.ZodType<Forecast> = z.object({
  forecastId: z.string().min(1),
  kind: RiskKindSchema,
  scope: ForecastScopeSchema,
  interval: ConformalIntervalSchema,
  drivers: z.array(z.object({
    name: z.string(),
    contribution: z.number(),
    narrative: z.string(),
  })).readonly(),
  modelVersion: z.string(),
  generatedAt: z.string(),
  featureFingerprint: z.string(),
});

// ─────────────────────────────────────────────────────────────────────
// Platform-scale forecast — aggregate, never per-node. Produced only
// from the DP-aggregated platform graph. Has NO tenantId; scoped by
// jurisdiction + property class + time bucket. This is the moat
// product: industry forecasts only we can produce.
// ─────────────────────────────────────────────────────────────────────

export interface PlatformForecastScope {
  /** ISO-3166-1 alpha-2 + optional admin-1 code (e.g. 'KE', 'KE-30'). */
  readonly jurisdiction: string;
  /** Class A / B / C / student / short-let / etc. */
  readonly propertyClass: string;
  readonly horizonDays: number;
  /** Aggregate metric (e.g. 'arrears_rate', 'vacancy_days', 'NOI_growth'). */
  readonly metric: string;
}

export interface PlatformForecast {
  readonly forecastId: string;
  readonly scope: PlatformForecastScope;
  readonly interval: ConformalInterval;
  readonly drivers: ReadonlyArray<ForecastDriver>;
  readonly modelVersion: string;
  readonly generatedAt: string;
  /** Number of distinct tenants whose data contributed. Never the
   *  names — just the count, floored at a minimum threshold so the
   *  figure itself isn't identifying. */
  readonly contributingTenants: number;
  /** Differential-privacy epsilon consumed. */
  readonly privacyCost: number;
}

// ─────────────────────────────────────────────────────────────────────
// Ports — EVERYTHING talks to these, nothing talks to a concrete
// adapter. Lets us swap Memgraph for Neo4j, in-memory for Postgres,
// real for fake-in-test (with REAL behaviour) without churn.
// ─────────────────────────────────────────────────────────────────────

export interface FeatureStore {
  /** Compute (or look up) a feature vector for the given scope.
   *  Must never return features from another tenant's graph. */
  build(scope: ForecastScope, ctx: AuthContext): Promise<FeatureVector>;
}

export interface Forecaster {
  /** Produce a fresh forecast. Pure — same inputs produce the same
   *  forecastId (deterministic hash). */
  forecast(
    kind: RiskKind,
    features: FeatureVector,
    ctx: AuthContext,
  ): Promise<Forecast>;
}

export interface ForecastRepository {
  save(forecast: Forecast, ctx: AuthContext): Promise<void>;
  load(forecastId: string, ctx: AuthContext): Promise<Forecast | null>;
  /** List recent forecasts for a scope, in reverse-chronological
   *  order. Tenant-scoped; never crosses. */
  listForScope(
    scope: Pick<ForecastScope, 'tenantId' | 'nodeLabel' | 'nodeId'>,
    ctx: AuthContext,
    limit: number,
  ): Promise<ReadonlyArray<Forecast>>;
}

/**
 * Auth context — every forecast call carries it. Gatekeeping lives
 * at the port boundary so no caller can accidentally produce cross-
 * tenant outputs. Platform-scope calls use a distinct AuthContext
 * kind so the type system forbids mixing.
 */
export type AuthContext =
  | {
      readonly kind: 'tenant';
      readonly tenantId: string;
      readonly actorUserId: string;
      readonly roles: ReadonlyArray<string>;
    }
  | {
      readonly kind: 'platform';
      readonly actorUserId: string;
      readonly roles: ReadonlyArray<string>;
    };

// ─────────────────────────────────────────────────────────────────────
// Graph signals — what the forecaster emits into the existing
// proactive-loop. Consumed by ai-copilot/proactive-loop which already
// knows how to route these to approval or auto-execute.
// ─────────────────────────────────────────────────────────────────────

export interface GraphSignal {
  readonly signalId: string;
  readonly kind: RiskKind;
  readonly scope: ForecastScope;
  readonly interval: ConformalInterval;
  readonly strength: number;          // [0,1] derived from interval + kind
  readonly driver: ForecastDriver;    // strongest single driver
  readonly forecastId: string;
  readonly emittedAt: string;
}

// Exhaustiveness helper — use at the end of every RiskKind switch so
// an added kind fails the build until every consumer handles it.
export function assertExhaustiveRiskKind(value: never): never {
  throw new Error(`forecasting: unhandled risk kind ${String(value)}`);
}

// ═════════════════════════════════════════════════════════════════════
// Time-series forecasting layer (added 2026-05-24)
//
// Complements the per-node graph forecaster above with a univariate
// time-series layer: rent, occupancy, churn, maintenance, energy,
// market-cycle. Composes foundation-model adapters (Chronos/TimesFM/
// TimeGPT) with local pure-TS baselines (naive, MA, Holt-Winters,
// linear-regression) and a conformal-interval wrapper.
//
// All types are pure contracts. No runtime.
// ═════════════════════════════════════════════════════════════════════

/** A single observation in a univariate time-series. */
export interface TimePoint {
  /** ISO timestamp of the observation. Strictly increasing across the series. */
  readonly t: string;
  /** Observed scalar value. Must be finite. */
  readonly y: number;
}

export const TimePointSchema: z.ZodType<TimePoint> = z.object({
  t: z.string().min(1),
  y: z.number().finite(),
});

/** Sampling frequency of a series. */
export const TIME_SERIES_FREQUENCIES = [
  'hourly',
  'daily',
  'weekly',
  'monthly',
  'quarterly',
  'yearly',
] as const;

export type TimeSeriesFrequency = (typeof TIME_SERIES_FREQUENCIES)[number];

/** A named univariate time-series. */
export interface TimeSeries {
  readonly id: string;
  readonly frequency: TimeSeriesFrequency;
  readonly points: ReadonlyArray<TimePoint>;
  /** Optional unit-of-measure ('TZS', 'kWh', 'pct', etc.) */
  readonly unit?: string;
  /** Optional jurisdiction code (ISO-3166) for jurisdictional logic. */
  readonly jurisdiction?: string;
}

export const TimeSeriesSchema = z.object({
  id: z.string().min(1),
  frequency: z.enum(TIME_SERIES_FREQUENCIES),
  points: z.array(TimePointSchema),
  unit: z.string().optional(),
  jurisdiction: z.string().optional(),
});

/** Forecast horizon (number of frequency-steps into the future). */
export interface Horizon {
  /** Steps ahead (1 = next bucket). */
  readonly steps: number;
}

export const HorizonSchema: z.ZodType<Horizon> = z.object({
  steps: z.number().int().positive().max(1000),
});

/** Forecast interval — point + lower + upper, optionally conformal-calibrated. */
export interface ForecastInterval {
  /** Step number ahead (1-indexed). */
  readonly step: number;
  /** Predicted ISO timestamp for this step. */
  readonly t: string;
  /** Point prediction. */
  readonly point: number;
  /** Lower bound of the prediction interval. */
  readonly lower: number;
  /** Upper bound of the prediction interval. */
  readonly upper: number;
  /** Target miscoverage rate alpha. Coverage = 1 - alpha. */
  readonly alpha: number;
  /** True iff the interval was produced by a conformal calibrator
   *  (not a parametric/uncalibrated heuristic). */
  readonly conformal: boolean;
}

export const ForecastIntervalSchema: z.ZodType<ForecastInterval> = z.object({
  step:      z.number().int().positive(),
  t:         z.string().min(1),
  point:     z.number().finite(),
  lower:     z.number().finite(),
  upper:     z.number().finite(),
  alpha:     z.number().min(0.001).max(0.5),
  conformal: z.boolean(),
});

/** Multi-step time-series forecast — what every adapter returns. */
export interface TimeSeriesForecast {
  readonly seriesId: string;
  readonly modelKind: ModelKind;
  readonly modelVersion: string;
  readonly horizon: Horizon;
  readonly points: ReadonlyArray<ForecastInterval>;
  readonly generatedAt: string;
  /** Optional driver/feature attributions (best-effort). */
  readonly drivers?: ReadonlyArray<ForecastDriver>;
  /** Optional metadata bag (model-specific). Always JSON-serialisable. */
  readonly meta?: Readonly<Record<string, string | number | boolean>>;
}

export const TIME_SERIES_FORECAST_KINDS = [
  'naive-seasonal',
  'moving-average',
  'holt-winters',
  'linear-regression',
  'chronos',
  'timesfm',
  'timegpt',
  'llm-zero-shot',
  'ensemble',
  're-rent',
  're-occupancy',
  're-churn',
  're-maintenance',
  're-energy',
  're-market-cycle',
] as const;

export type ModelKind = (typeof TIME_SERIES_FORECAST_KINDS)[number];

export const ModelKindSchema = z.enum(TIME_SERIES_FORECAST_KINDS);

/** Options forwarded to a forecaster. Always optional. */
export interface ForecastingOptions {
  /** Miscoverage rate; default 0.1 (90% interval). */
  readonly alpha?: number;
  /** Seasonal period (in steps) hint. */
  readonly seasonality?: number;
  /** Bag of model-specific options; opaque to the port. */
  readonly extra?: Readonly<Record<string, unknown>>;
}

/** The forecaster port — implemented by every model adapter. */
export interface ForecastingPort {
  readonly kind: ModelKind;
  predict(args: {
    readonly series: TimeSeries;
    readonly horizon: Horizon;
    readonly opts?: ForecastingOptions;
  }): Promise<TimeSeriesForecast>;
}

/** Backtest evaluation result. */
export interface BacktestMetricResult {
  readonly metric: 'mae' | 'mape' | 'rmse' | 'mase' | 'crps';
  readonly value: number;
}

export interface BacktestSplit {
  /** Split index (0-based). */
  readonly index: number;
  /** Number of training points used. */
  readonly trainSize: number;
  /** Number of validation points used. */
  readonly testSize: number;
  /** Per-step error for this split (length = horizon.steps). */
  readonly residuals: ReadonlyArray<number>;
}

export interface BacktestResult {
  readonly seriesId: string;
  readonly modelKind: ModelKind;
  readonly splits: ReadonlyArray<BacktestSplit>;
  readonly metrics: ReadonlyArray<BacktestMetricResult>;
}

/** Detected anomaly in a series. */
export interface Anomaly {
  /** Index in the series (0-based). */
  readonly index: number;
  /** Timestamp of the anomalous point. */
  readonly t: string;
  /** Observed value. */
  readonly y: number;
  /** Anomaly score (higher = more anomalous). */
  readonly score: number;
  /** Detection method that flagged it. */
  readonly method: 'zscore' | 'change-point' | 'isolation-forest';
}
