/**
 * Cashflow-dip detector.
 *
 * Consumes the forecaster ensemble's CashflowForecastSlice (p10/p50/p90
 * over the horizon) + the tenant's safety-floor. Flags when the
 * predicted p10 path dips below the floor — that's the "want me to
 * draft an STK push reminder?" moment in the vision.
 *
 * Pure function. No I/O. Idempotent on (tenantId, dip-day).
 */
import type { AnomalyEvent, Confidence, Severity } from '../contracts/events.js';
import type { TickContext } from '../scheduler/tick-context.js';
import type { ForecastBand } from '../contracts/forecast-input.js';

/** Sigma multiplier: how many residual std-devs below floor counts as a dip. */
const DEFAULT_SIGMA_THRESHOLD = 1.0;

export function detectCashflowDip(ctx: TickContext): ReadonlyArray<AnomalyEvent> {
  const cashflow = ctx.inputs.cashflow;
  if (!cashflow || cashflow.tenantId !== ctx.tenantId) return [];
  if (cashflow.bands.length === 0) return [];

  const firstDip = findFirstDip(cashflow.bands, cashflow.safetyFloor);
  if (!firstDip) return [];

  const severity = pickSeverity(firstDip.daysOut);
  const confidence = pickConfidence(firstDip.band, cashflow.safetyFloor);

  return [
    {
      type: 'anomaly',
      kind: 'cashflow-dip',
      id: `cashflow-dip:${cashflow.tenantId}:${dayKey(firstDip.band.t)}`,
      tenantId: ctx.tenantId,
      scope: ctx.scope,
      detectedAt: new Date(ctx.nowMs).toISOString(),
      confidence,
      severity,
      headline: composeHeadline(firstDip.daysOut, firstDip.band, cashflow.safetyFloor),
      evidence: {
        safetyFloor: cashflow.safetyFloor,
        cashBalanceNow: cashflow.cashBalanceNow,
        dipAtMs: firstDip.band.t,
        daysOut: firstDip.daysOut,
        p10AtDip: firstDip.band.p10,
        p50AtDip: firstDip.band.p50,
        sigmaThreshold: DEFAULT_SIGMA_THRESHOLD,
      },
    },
  ];
}

interface DipHit {
  readonly band: ForecastBand;
  readonly daysOut: number;
}

function findFirstDip(
  bands: ReadonlyArray<ForecastBand>,
  floor: number,
): DipHit | null {
  const t0 = bands[0]?.t ?? 0;
  for (const band of bands) {
    // Sigma proxy: half-width of the p10-p90 band approximates 2*sigma.
    const sigma = Math.max(0, (band.p90 - band.p10) / 2);
    const threshold = floor + DEFAULT_SIGMA_THRESHOLD * sigma;
    if (band.p10 < floor || band.p50 < threshold) {
      const daysOut = Math.max(0, Math.round((band.t - t0) / (24 * 60 * 60 * 1000)));
      return { band, daysOut };
    }
  }
  return null;
}

function pickSeverity(daysOut: number): Severity {
  if (daysOut <= 7) return 'P0';
  if (daysOut <= 14) return 'P1';
  if (daysOut <= 30) return 'P2';
  return 'P3';
}

function pickConfidence(band: ForecastBand, floor: number): Confidence {
  const gap = floor - band.p50;
  const width = Math.max(1, band.p90 - band.p10);
  const zScore = gap / (width / 2);
  if (zScore > 1.5) return { label: 'high', score: 0.9 };
  if (zScore > 0.5) return { label: 'medium', score: 0.7 };
  return { label: 'low', score: 0.55 };
}

function composeHeadline(daysOut: number, band: ForecastBand, floor: number): string {
  const shortfall = Math.max(0, floor - band.p50);
  return `Cash dips ~${shortfall.toFixed(0)} below your floor in ~${daysOut} day(s).`;
}

function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}
