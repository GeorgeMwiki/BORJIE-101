/**
 * SLO-breach detector.
 *
 * Watches forecaster MAE (mean absolute error). When the 7d MAE rises
 * more than 30% above the 30d baseline, the forecaster is drifting —
 * worth a heads-up so the owner doesn't lean on a stale model.
 *
 * Operates on a list of SloObservation, one per forecaster.
 */
import type { AnomalyEvent, Confidence, Severity } from '../contracts/events.js';
import type { TickContext } from '../scheduler/tick-context.js';

const DRIFT_FACTOR = 1.3;
const MIN_BASELINE = 1e-6; // numerical floor

export function detectSloBreach(ctx: TickContext): ReadonlyArray<AnomalyEvent> {
  const slos = ctx.inputs.slo ?? [];
  const out: AnomalyEvent[] = [];

  for (const slo of slos) {
    if (slo.mae30dBaseline < MIN_BASELINE) continue;
    const ratio = slo.mae7d / slo.mae30dBaseline;
    if (ratio < DRIFT_FACTOR) continue;

    out.push({
      type: 'anomaly',
      kind: 'slo-breach',
      id: `slo-breach:${ctx.tenantId ?? 'platform'}:${slo.forecaster}`,
      tenantId: ctx.tenantId,
      scope: ctx.scope,
      detectedAt: new Date(ctx.nowMs).toISOString(),
      confidence: pickConfidence(ratio),
      severity: pickSeverity(ratio),
      headline: `Forecaster ${slo.forecaster} MAE up ${((ratio - 1) * 100).toFixed(0)}% — drift detected.`,
      evidence: {
        forecaster: slo.forecaster,
        mae7d: slo.mae7d,
        mae30dBaseline: slo.mae30dBaseline,
        ratio,
        driftFactor: DRIFT_FACTOR,
      },
    });
  }
  return out;
}

function pickSeverity(ratio: number): Severity {
  if (ratio >= 2.5) return 'P0';
  if (ratio >= 2) return 'P1';
  if (ratio >= 1.5) return 'P2';
  return 'P3';
}

function pickConfidence(ratio: number): Confidence {
  if (ratio >= 2) return { label: 'high', score: 0.85 };
  if (ratio >= 1.5) return { label: 'medium', score: 0.7 };
  return { label: 'low', score: 0.55 };
}
