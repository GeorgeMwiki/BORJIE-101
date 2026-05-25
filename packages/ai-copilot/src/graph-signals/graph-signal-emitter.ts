/**
 * GraphSignalEmitter — maps a `Forecast` onto the proactive-loop
 * `Signal` contract and (optionally) hands it to a ProactiveOrchestrator
 * in a single step.
 *
 * Design constraints:
 *   - Pure mapping; no hidden I/O.
 *   - `signalId` is deterministic per `forecastId` so re-emitting the
 *     same forecast does not fan-out duplicate signals downstream.
 *   - Source is always `'forecasting'`.
 *   - `tenantId` is ALWAYS pulled from `forecast.scope.tenantId`. The
 *     emitter does not accept a free-form tenant override — the
 *     forecasting package enforces tenant/scope equality at
 *     construction time, so trusting `scope.tenantId` is safe.
 *   - Severity is derived from both the point estimate AND the lower
 *     bound: a forecast whose OPTIMISTIC scenario still breaches the
 *     threshold is always 'critical'.
 *   - Domain is derived from the RiskKind via an exhaustive mapper so
 *     new RiskKinds fail the build until routed.
 */

import { randomUUID } from 'node:crypto';
import type { Forecast, RiskKind } from '@borjie/forecasting';
import { assertExhaustiveRiskKind } from '@borjie/forecasting';

import type { AutonomyDomain } from '../autonomy/types.js';
import type {
  Signal,
  SignalSeverity,
} from '../proactive-loop/types.js';
import type { ProactiveOrchestrator, IngestResult } from '../proactive-loop/proactive-orchestrator.js';

import {
  DEFAULT_THRESHOLDS,
  classifySeverity,
  type GraphSignalPayload,
  type ThresholdRegistry,
} from './types.js';

// ─────────────────────────────────────────────────────────────────────
// Domain routing — every RiskKind maps to an AutonomyDomain so the
// proactive-loop's policy gate can resolve a per-tenant threshold.
// ─────────────────────────────────────────────────────────────────────

export function domainForRiskKind(kind: RiskKind): AutonomyDomain {
  switch (kind) {
    case 'arrears_risk':
    case 'payment_method_decay':
      return 'finance';
    case 'churn_risk':
    case 'renewal_opportunity':
    case 'void_risk':
      return 'leasing';
    case 'incident_risk':
    case 'repair_recurrence':
      return 'maintenance';
    case 'vendor_decay':
      return 'procurement';
    case 'compliance_drift':
      return 'compliance';
    case 'litigation_exposure':
      return 'legal_proceedings';
    default:
      return assertExhaustiveRiskKind(kind);
  }
}

// ─────────────────────────────────────────────────────────────────────
// signalType — a narrow synonym of RiskKind kept on `Signal.payload`
// so existing template matchers can key off it without touching the
// forecasting types directly.
// ─────────────────────────────────────────────────────────────────────

export function signalTypeForRiskKind(kind: RiskKind): string {
  // The RiskKind value IS the signalType. Kept as a separate helper so
  // a future renaming / prefixing pass has exactly one edit point.
  return `forecast.${kind}`;
}

// ─────────────────────────────────────────────────────────────────────
// Strongest driver — used by the proactive-loop template matcher to
// surface a human-readable rationale without re-ranking the full
// driver list.
// ─────────────────────────────────────────────────────────────────────

function pickStrongestDriver(
  forecast: Forecast,
): Forecast['drivers'][number] | null {
  if (forecast.drivers.length === 0) return null;
  let strongest = forecast.drivers[0]!;
  for (let i = 1; i < forecast.drivers.length; i += 1) {
    const candidate = forecast.drivers[i]!;
    if (Math.abs(candidate.contribution) > Math.abs(strongest.contribution)) {
      strongest = candidate;
    }
  }
  return strongest;
}

// ─────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────

export interface GraphSignalEmitterDeps {
  /** Per-kind severity thresholds. Defaults to `DEFAULT_THRESHOLDS`. */
  readonly thresholds?: ThresholdRegistry;
  /** Injectable clock for deterministic `detectedAt`. Tests pass a
   *  fixed clock; production uses the wall clock. */
  readonly clock?: () => Date;
  /** Signal id generator. Defaults to a deterministic
   *  `sig_forecast_${forecastId}` so re-emitting the same forecast
   *  does not duplicate signals downstream. Tests override with a
   *  counter. */
  readonly signalId?: (forecast: Forecast) => string;
}

export interface GraphSignalEmitter {
  /** Map a forecast to a Signal without side effects. */
  toSignal(forecast: Forecast): Signal;
  /** Map a forecast to a Signal AND feed it through a
   *  ProactiveOrchestrator.ingestSignal in one call. The
   *  orchestrator's own error handling keeps this safe — failures are
   *  captured as audit events, never thrown. */
  emit(
    forecast: Forecast,
    orchestrator: ProactiveOrchestrator,
  ): Promise<IngestResult>;
}

export function createGraphSignalEmitter(
  deps: GraphSignalEmitterDeps = {},
): GraphSignalEmitter {
  const thresholds = deps.thresholds ?? DEFAULT_THRESHOLDS;
  const clock = deps.clock ?? (() => new Date());
  const signalIdFn =
    deps.signalId ??
    ((forecast: Forecast): string => `sig_forecast_${forecast.forecastId}`);

  function toSignal(forecast: Forecast): Signal {
    const kindThresholds = thresholds[forecast.kind];
    if (!kindThresholds) {
      // Defensive — the ThresholdRegistry is typed as total, but a
      // caller could have passed a partial object via `as` casts.
      throw new Error(
        `graph-signal-emitter: no thresholds registered for kind ${forecast.kind}`,
      );
    }
    const decision = classifySeverity(forecast, kindThresholds);
    const severity: SignalSeverity = decision.severity;

    const strongest = pickStrongestDriver(forecast);

    const payload: GraphSignalPayload & {
      readonly signalType: string;
      readonly severityReason: string;
      readonly strongestDriver: Forecast['drivers'][number] | null;
    } = Object.freeze({
      signalType: signalTypeForRiskKind(forecast.kind),
      severityReason: decision.reason,
      forecastId: forecast.forecastId,
      kind: forecast.kind,
      nodeLabel: forecast.scope.nodeLabel,
      nodeId: forecast.scope.nodeId,
      horizonDays: forecast.scope.horizonDays,
      point: forecast.interval.point,
      lower: forecast.interval.lower,
      upper: forecast.interval.upper,
      alpha: forecast.interval.alpha,
      modelVersion: forecast.modelVersion,
      featureFingerprint: forecast.featureFingerprint,
      drivers: forecast.drivers.map((d) =>
        Object.freeze({
          name: d.name,
          contribution: d.contribution,
          narrative: d.narrative,
        }),
      ),
      strongestDriver: strongest
        ? Object.freeze({
            name: strongest.name,
            contribution: strongest.contribution,
            narrative: strongest.narrative,
          })
        : null,
    });

    const signal: Signal = Object.freeze({
      signalId: signalIdFn(forecast) || `sig_${randomUUID()}`,
      source: 'forecasting',
      tenantId: forecast.scope.tenantId,
      domain: domainForRiskKind(forecast.kind),
      severity,
      payload: payload as unknown as Readonly<Record<string, unknown>>,
      detectedAt: clock().toISOString(),
    });
    return signal;
  }

  async function emit(
    forecast: Forecast,
    orchestrator: ProactiveOrchestrator,
  ): Promise<IngestResult> {
    const signal = toSignal(forecast);
    return orchestrator.ingestSignal(signal);
  }

  return { toSignal, emit };
}
