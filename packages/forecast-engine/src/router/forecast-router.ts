/**
 * Portfolio router — pick a method by horizon / data-regime, run the
 * classical floor IN PARALLEL with any candidate, REJECT/flag any model
 * that fails to beat the floor on held-out backtest, blend if configured,
 * then calibrate the chosen forecast with the conformal wrapper.
 *
 * Routing policy (foundation-models dossier §4):
 *  - short / intermittent / short-horizon / high-frequency -> classical floor.
 *  - regular + long horizon -> escalate to a TSFM provider, but ONLY if it
 *    beats the floor on a rolling-origin backtest. Otherwise keep the floor
 *    and flag `baselineBeaten = false`.
 *
 * Every returned forecast carries >=1 evidence_id stamped with
 * {model, version, inputWindow, horizon, coverage, baselineBeaten}.
 *
 * Pure orchestration; async only because providers are async ports.
 */

import type { ForecastProviderPort } from '../providers/port.js';
import type { ProviderRegistry } from '../providers/registry.js';
import {
  calibrateForecast,
  type CalibrationRecord,
  type ConformalMode,
} from '../conformal/conformal-wrap.js';
import type {
  EvidenceId,
  ForecastRequest,
  ForecastResult,
  PredictionInterval,
  QuantileForecast,
  RawForecast,
} from '../types.js';
import { DEFAULT_QUANTILES } from '../types.js';
import { quantileKey } from '../util/quantiles.js';
import {
  backtestProvider,
  beatsFloor,
  type BacktestScore,
} from './backtest.js';
import { classifyRegime } from './regime-classifier.js';

export interface RouterConfig {
  /**
   * Candidate TSFM provider name to try for long-horizon regular series.
   * Resolved from the registry; if absent/unavailable the floor wins.
   */
  readonly candidateProvider?: string;
  /** Conformal mode for interval calibration. Default 'cqr'. */
  readonly conformalMode?: ConformalMode;
  /**
   * If true and the candidate beats the floor, BLEND the two median
   * paths (simple mean) instead of taking the candidate outright. The
   * floor always remains an input — predictions append, never replace.
   * Default false (winner-take, floor as fallback).
   */
  readonly blend?: boolean;
  /** Min MASE improvement for the candidate to count as beating the floor. */
  readonly floorBeatMargin?: number;
}

export interface RouteOutcome {
  readonly result: ForecastResult;
  /** The floor's backtest score (always computed). */
  readonly floorScore: BacktestScore;
  /** The candidate's backtest score, if a candidate was evaluated. */
  readonly candidateScore?: BacktestScore;
  /** True iff a candidate model was escalated above the floor. */
  readonly escalated: boolean;
}

function deterministicForecastId(req: ForecastRequest): string {
  const basis = `${req.tenantId ?? 'GLOBAL'}|${req.target}|${req.series.seriesId}|h${req.horizon}|n${req.series.values.length}`;
  // Small, dependency-free FNV-1a hash — deterministic, not crypto.
  let h = 0x811c9dc5;
  for (let i = 0; i < basis.length; i++) {
    h ^= basis.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `fc_${(h >>> 0).toString(16)}`;
}

function evidenceId(
  forecastId: string,
  raw: RawForecast,
  inputWindow: number,
  horizon: number,
  coverage: number,
  baselineBeaten: boolean,
): EvidenceId {
  return {
    id: `${forecastId}:${raw.model}@${raw.modelVersion}`,
    model: raw.model,
    version: raw.modelVersion,
    inputWindow,
    horizon,
    coverage,
    baselineBeaten,
  };
}

/** Blend two raw forecasts by averaging matching quantiles step-wise. */
function blendRaw(a: RawForecast, b: RawForecast): RawForecast {
  const steps: QuantileForecast[] = a.steps.map((sa, i) => {
    const sb = b.steps[i];
    if (!sb) return sa;
    const quantiles: Record<string, number> = {};
    for (const k of Object.keys(sa.quantiles)) {
      const va = sa.quantiles[k] ?? sa.point;
      const vb = sb.quantiles[k] ?? sb.point;
      quantiles[k] = (va + vb) / 2;
    }
    return {
      step: sa.step,
      point: (sa.point + sb.point) / 2,
      quantiles,
    };
  });
  return {
    model: `blend(${a.model}+${b.model})`,
    modelVersion: `${a.modelVersion}|${b.modelVersion}`,
    steps,
    latencyMs: a.latencyMs + b.latencyMs,
  };
}

/**
 * Build a split-conformal calibration set from the tail of the history:
 * fit on the head, forecast the held-out tail with the chosen provider,
 * and pair each forecast with its actual. Used to calibrate intervals.
 */
async function buildCalibration(
  provider: ForecastProviderPort,
  req: ForecastRequest,
  quantiles: ReadonlyArray<number>,
  alpha: number,
): Promise<CalibrationRecord[]> {
  const n = req.series.values.length;
  const seasonLength = Math.max(1, Math.floor(req.series.seasonLength ?? 1));
  const holdout = Math.max(1, Math.min(Math.floor(n / 4), n - seasonLength - 1));
  if (holdout < 1 || n - holdout <= seasonLength) return [];
  const train = req.series.values.slice(0, n - holdout);
  const actuals = req.series.values.slice(n - holdout);
  const raw = await provider.forecast(
    {
      ...req.series,
      values: train,
      ...(req.series.timestamps
        ? { timestamps: req.series.timestamps.slice(0, n - holdout) }
        : {}),
    },
    holdout,
    quantiles,
  );
  const loKey = quantileKey(alpha / 2);
  const hiKey = quantileKey(1 - alpha / 2);
  const records: CalibrationRecord[] = [];
  for (let i = 0; i < actuals.length && i < raw.steps.length; i++) {
    const step = raw.steps[i] as QuantileForecast;
    records.push({
      point: step.point,
      actual: actuals[i] as number,
      lowerQuantile: step.quantiles[loKey] ?? step.point,
      upperQuantile: step.quantiles[hiKey] ?? step.point,
    });
  }
  return records;
}

export interface ForecastRouter {
  route(req: ForecastRequest): Promise<RouteOutcome>;
}

export function createForecastRouter(
  registry: ProviderRegistry,
  config: RouterConfig = {},
): ForecastRouter {
  return {
    async route(req: ForecastRequest): Promise<RouteOutcome> {
      const quantiles = req.quantiles ?? DEFAULT_QUANTILES;
      const coverage = req.targetCoverage ?? 0.9;
      const alpha = Math.min(0.5, Math.max(0.001, 1 - coverage));
      const horizon = req.horizon;
      const inputWindow = req.series.values.length;
      const forecastId = deterministicForecastId(req);

      const floor = registry.floor();
      const assessment = classifyRegime(req.series, horizon);

      // Floor is ALWAYS computed (rule-based decision input + fallback).
      const floorScore = await backtestProvider(floor, req.series, { quantiles });

      // Decide whether to even consider a candidate.
      const candidate =
        !assessment.preferClassical && config.candidateProvider
          ? registry.get(config.candidateProvider)
          : undefined;

      let chosen: ForecastProviderPort = floor;
      let escalated = false;
      let baselineBeaten = false;
      let candidateScore: BacktestScore | undefined;
      let blendWith: ForecastProviderPort | undefined;

      if (candidate) {
        const health = await candidate.health();
        if (health.available) {
          candidateScore = await backtestProvider(candidate, req.series, {
            quantiles,
          });
          if (beatsFloor(candidateScore, floorScore, config.floorBeatMargin)) {
            escalated = true;
            baselineBeaten = true;
            if (config.blend) {
              chosen = candidate;
              blendWith = floor;
            } else {
              chosen = candidate;
            }
          }
        }
      }

      // Produce the final raw forecast from the chosen provider (+ blend).
      let raw = await chosen.forecast(req.series, horizon, quantiles);
      if (blendWith) {
        const floorRaw = await blendWith.forecast(req.series, horizon, quantiles);
        raw = blendRaw(raw, floorRaw);
      }

      // Calibrate via the conformal wrapper using a held-out calibration set.
      const calibration = await buildCalibration(chosen, req, quantiles, alpha);
      const wrapped = calibrateForecast(raw, calibration, {
        targetCoverage: coverage,
        ...(config.conformalMode ? { mode: config.conformalMode } : {}),
      });

      const points: QuantileForecast[] = raw.steps.map((s) => s);
      const intervals: ReadonlyArray<PredictionInterval> = wrapped.intervals;

      const evidence: EvidenceId[] = [
        evidenceId(forecastId, raw, inputWindow, horizon, coverage, baselineBeaten),
      ];
      // The floor is always an input — cite it too (append-never-replace).
      if (chosen.name !== floor.name) {
        const floorRaw = await floor.forecast(req.series, 1, quantiles);
        evidence.push(
          evidenceId(forecastId, floorRaw, inputWindow, 1, coverage, false),
        );
      }

      const result: ForecastResult = {
        forecastId,
        tenantId: req.tenantId,
        target: req.target,
        horizon,
        points,
        intervals,
        model: raw.model,
        modelVersion: raw.modelVersion,
        baselineBeaten,
        conformalCoverage: wrapped.coverage,
        evidenceIds: evidence,
        ...(req.series.currencyCode
          ? { currencyCode: req.series.currencyCode }
          : {}),
      };

      return {
        result,
        floorScore,
        ...(candidateScore ? { candidateScore } : {}),
        escalated,
      };
    },
  };
}
