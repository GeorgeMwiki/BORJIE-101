/**
 * `report.detect_anomalies` — read tier.
 *
 * Uses the forecasting-engine outcome-recorder (injected via port)
 * to find predicted-vs-actual deltas that exceed a tolerance. Any
 * delta past `severity-threshold` is flagged for the briefing.
 */

import type { PortfolioKpiSnapshot } from './gather-kpis.js';

export interface ForecastSnapshot {
  readonly grossCollectedMinor: number;
  readonly occupancyRate: number;
  readonly emergencyTicketsThisWeek: number;
  readonly newArrearsThisWeek: number;
  readonly criticalComplaintsThisWeek: number;
}

export interface ForecastReplayPort {
  /** Returns the forecast we made for this period. */
  read(args: {
    readonly tenantId: string;
    readonly periodStartMs: number;
    readonly periodEndMs: number;
  }): Promise<ForecastSnapshot | null>;
}

export interface Anomaly {
  readonly metric: string;
  readonly actual: number;
  readonly predicted: number;
  readonly delta: number;
  readonly relativeError: number;
  readonly severity: 'minor' | 'moderate' | 'major';
  readonly direction: 'over-performed' | 'under-performed';
}

export interface DetectAnomaliesArgs {
  readonly snapshot: PortfolioKpiSnapshot;
  readonly forecastPort: ForecastReplayPort;
  readonly tenantId: string;
  /** Relative-error thresholds; defaults: minor 5%, moderate 10%,
   *  major 20%. */
  readonly thresholds?: {
    readonly minorPct?: number;
    readonly moderatePct?: number;
    readonly majorPct?: number;
  };
}

export interface DetectAnomaliesResult {
  readonly anomalies: ReadonlyArray<Anomaly>;
  readonly forecastFound: boolean;
}

const DEFAULTS = { minorPct: 0.05, moderatePct: 0.1, majorPct: 0.2 };

export async function detectAnomalies(args: DetectAnomaliesArgs): Promise<DetectAnomaliesResult> {
  const t = { ...DEFAULTS, ...(args.thresholds ?? {}) };
  const forecast = await args.forecastPort.read({
    tenantId: args.tenantId,
    periodStartMs: args.snapshot.periodStartMs,
    periodEndMs: args.snapshot.periodEndMs,
  });
  if (!forecast) {
    return Object.freeze({ anomalies: Object.freeze([]), forecastFound: false });
  }
  const anomalies: Anomaly[] = [];
  pushIfAnomaly(anomalies, 'grossCollectedMinor', args.snapshot.cashflow.grossCollectedMinor, forecast.grossCollectedMinor, t);
  pushIfAnomaly(anomalies, 'occupancyRate', args.snapshot.occupancy.occupancyRate, forecast.occupancyRate, t);
  pushIfAnomaly(anomalies, 'emergencyTicketsThisWeek', args.snapshot.maintenance.emergencyTicketsThisWeek, forecast.emergencyTicketsThisWeek, t);
  pushIfAnomaly(anomalies, 'newArrearsThisWeek', args.snapshot.arrears.newArrearsThisWeek, forecast.newArrearsThisWeek, t);
  pushIfAnomaly(anomalies, 'criticalComplaintsThisWeek', args.snapshot.complaints.criticalComplaintsThisWeek, forecast.criticalComplaintsThisWeek, t);
  return Object.freeze({ anomalies: Object.freeze(anomalies), forecastFound: true });
}

function pushIfAnomaly(
  arr: Anomaly[],
  metric: string,
  actual: number,
  predicted: number,
  t: typeof DEFAULTS,
): void {
  const delta = actual - predicted;
  const denom = Math.abs(predicted) < 1e-9 ? 1 : Math.abs(predicted);
  const relErr = Math.abs(delta) / denom;
  if (relErr < t.minorPct) return;
  let severity: Anomaly['severity'];
  if (relErr >= t.majorPct) severity = 'major';
  else if (relErr >= t.moderatePct) severity = 'moderate';
  else severity = 'minor';
  arr.push({
    metric,
    actual,
    predicted,
    delta,
    relativeError: Number(relErr.toFixed(4)),
    severity,
    direction: delta >= 0 ? 'over-performed' : 'under-performed',
  });
}
