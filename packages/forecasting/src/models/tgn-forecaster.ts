/**
 * Temporal Graph Network forecaster — per-org.
 *
 * The forecaster itself is a port (interface). The concrete inference
 * runtime (TorchScript via ONNX Runtime, TensorFlow Lite, a remote
 * HTTP endpoint, or a deterministic rule engine for the floor model)
 * is injected. This file contains:
 *
 *   - the `TgnInferenceAdapter` port
 *   - a `createTgnForecaster` factory that wires:
 *       inference adapter ← port
 *       calibration-backed conformal pricer ← port
 *       driver-attribution explainer         ← port
 *       deterministic forecast-id hasher
 *
 * The pattern: we do not ship a neural network in this TypeScript
 * package. We ship the contract + the production wiring. A separate
 * inference service (Python + PyTorch + PyG, deployed as its own
 * sidecar) implements the port. That is the correct architecture for
 * ML in a TS monorepo — keep the heavy lifting out, keep the
 * orchestration + audit + conformal-pricing here where it's typed
 * end-to-end.
 */

import type {
  AuthContext,
  ConformalInterval,
  FeatureVector,
  Forecast,
  ForecastDriver,
  Forecaster,
  RiskKind,
} from '../types.js';
import { sha256Hex, sha256Short } from '../util/hash.js';
import type { Calibrator } from '../conformal/inductive.js';
import { logger } from '../logger.js';

// ─────────────────────────────────────────────────────────────────────
// Ports consumed by the forecaster
// ─────────────────────────────────────────────────────────────────────

export interface TgnInferencePrediction {
  /** Point estimate. For probability kinds, in [0,1]. */
  readonly point: number;
  /** Per-feature signed attributions (e.g. from GNNExplainer or
   *  integrated-gradients). Ordered by absolute contribution, desc. */
  readonly featureAttributions: ReadonlyArray<{
    readonly name: string;
    readonly contribution: number;
  }>;
  /** Opaque model version string the inference service returned. */
  readonly modelVersion: string;
}

/** Remote (or local) TGN inference. Called once per forecast. */
export interface TgnInferenceAdapter {
  infer(args: {
    readonly kind: RiskKind;
    readonly features: FeatureVector;
    readonly ctx: AuthContext;
  }): Promise<TgnInferencePrediction>;
}

/** Explainer — turns raw attributions into readable narrative text.
 *  Kept separate from inference so we can swap the LLM narrator
 *  (Claude Haiku) without re-deploying the inference service. */
export interface DriverExplainer {
  narrate(args: {
    readonly kind: RiskKind;
    readonly featureAttributions: TgnInferencePrediction['featureAttributions'];
    readonly features: FeatureVector;
    readonly ctx: AuthContext;
  }): Promise<ReadonlyArray<ForecastDriver>>;
}

/** Calibrator registry — one calibrator per `kind`. Stored out-of-band
 *  (Postgres or Redis) so calibration state survives restarts. */
export interface CalibratorRegistry {
  for(kind: RiskKind, ctx: AuthContext): Calibrator;
}

export interface TgnForecasterDeps {
  readonly inference: TgnInferenceAdapter;
  readonly explainer: DriverExplainer;
  readonly calibrators: CalibratorRegistry;
  readonly featureFingerprint: (v: FeatureVector) => string;
  readonly clock?: () => Date;
  /** Miscoverage rate alpha. Default 0.1 = 90% interval. */
  readonly alpha?: number;
}

export function createTgnForecaster(deps: TgnForecasterDeps): Forecaster {
  const now = deps.clock ?? (() => new Date());
  const alpha = deps.alpha ?? 0.1;

  return {
    async forecast(
      kind: RiskKind,
      features: FeatureVector,
      ctx: AuthContext,
    ): Promise<Forecast> {
      assertTenantContextMatchesFeatures(features, ctx);

      const prediction = await deps.inference.infer({ kind, features, ctx });
      const calibrator = deps.calibrators.for(kind, ctx);
      let interval: ConformalInterval;
      try {
        interval = calibrator.interval(prediction.point, alpha);
      } catch (err) {
        // Conformal pricing is gated on minimum calibration sample.
        // Early in a tenant's lifecycle we don't have the 30+ points
        // ICP requires, so we fall back to a WIDE uncalibrated
        // interval but clearly mark it so downstream consumers know
        // the coverage guarantee isn't active yet. Never silently
        // return a narrow unprotected interval.
        const width = Math.max(0.2, Math.abs(prediction.point) * 0.5);
        interval = {
          point: prediction.point,
          lower: prediction.point - width,
          upper: prediction.point + width,
          alpha: 0.99,         // mark explicitly as "uncalibrated wide band"
        };
        /* eslint-disable no-console */
        logger.warn('forecasting: calibrator under-sampled, returning uncalibrated band', { kind, err: (err as Error).message });
        /* eslint-enable no-console */
      }

      const drivers = await deps.explainer.narrate({
        kind,
        featureAttributions: prediction.featureAttributions,
        features,
        ctx,
      });

      const fingerprint = deps.featureFingerprint(features);
      const forecastId = deterministicForecastId({
        kind,
        scope: features.scope,
        modelVersion: prediction.modelVersion,
        fingerprint,
      });

      return Object.freeze({
        forecastId,
        kind,
        scope: features.scope,
        interval,
        drivers,
        modelVersion: prediction.modelVersion,
        generatedAt: now().toISOString(),
        featureFingerprint: fingerprint,
      });
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function assertTenantContextMatchesFeatures(
  features: FeatureVector,
  ctx: AuthContext,
): void {
  if (ctx.kind !== 'tenant') {
    throw new Error('forecasting: per-node forecast requires a tenant AuthContext');
  }
  if (features.scope.tenantId !== ctx.tenantId) {
    throw new Error(
      `forecasting: feature tenantId ${features.scope.tenantId} ≠ ctx tenantId ${ctx.tenantId}`,
    );
  }
}

function deterministicForecastId(args: {
  readonly kind: RiskKind;
  readonly scope: {
    readonly tenantId: string;
    readonly nodeLabel: string;
    readonly nodeId: string;
    readonly horizonDays: number;
  };
  readonly modelVersion: string;
  readonly fingerprint: string;
}): string {
  const seed =
    'fcst:' +
    args.kind + ':' +
    args.scope.tenantId + ':' +
    args.scope.nodeLabel + ':' +
    args.scope.nodeId + ':' +
    args.scope.horizonDays + ':' +
    args.modelVersion + ':' +
    args.fingerprint;
  return 'fcst_' + sha256Short(sha256Hex(seed), 16);
}
