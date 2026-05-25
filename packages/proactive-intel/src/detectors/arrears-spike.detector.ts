/**
 * Arrears-spike detector.
 *
 * Weekly arrears count vs the 4-week rolling mean. Flags when this
 * week's count exceeds the mean by a configurable factor (default
 * 1.5x), which is enough to overshoot natural seasonality.
 *
 * Pure function.
 */
import type { AnomalyEvent, Confidence, Severity } from '../contracts/events.js';
import type { TickContext } from '../scheduler/tick-context.js';

const SPIKE_FACTOR = 1.5;
const MIN_BASELINE_WEEKS = 4;

export function detectArrearsSpike(
  ctx: TickContext,
): ReadonlyArray<AnomalyEvent> {
  const series = ctx.inputs.arrears;
  if (!series || series.tenantId !== ctx.tenantId) return [];
  if (series.weeks.length < MIN_BASELINE_WEEKS + 1) return [];

  const weeks = series.weeks;
  const latest = weeks[weeks.length - 1];
  if (!latest) return [];

  const baselineWeeks = weeks.slice(-1 - MIN_BASELINE_WEEKS, -1);
  const baselineMean =
    baselineWeeks.reduce((sum, w) => sum + w.arrearsCount, 0) /
    Math.max(1, baselineWeeks.length);

  if (latest.arrearsCount < baselineMean * SPIKE_FACTOR) return [];
  if (baselineMean < 1) return []; // suppress noise on near-zero baselines

  const ratio = latest.arrearsCount / Math.max(1, baselineMean);
  const severity = pickSeverity(ratio);
  const confidence = pickConfidence(ratio);

  return [
    {
      type: 'anomaly',
      kind: 'arrears-spike',
      id: `arrears-spike:${series.tenantId}:${weekKey(latest.weekStartMs)}`,
      tenantId: ctx.tenantId,
      scope: ctx.scope,
      detectedAt: new Date(ctx.nowMs).toISOString(),
      confidence,
      severity,
      headline: `Arrears jumped to ${latest.arrearsCount} this week (vs 4-week mean of ${baselineMean.toFixed(1)}).`,
      evidence: {
        weekStartMs: latest.weekStartMs,
        arrearsCount: latest.arrearsCount,
        baselineMean,
        ratio,
        spikeFactor: SPIKE_FACTOR,
      },
    },
  ];
}

function pickSeverity(ratio: number): Severity {
  if (ratio >= 3) return 'P0';
  if (ratio >= 2) return 'P1';
  if (ratio >= 1.5) return 'P2';
  return 'P3';
}

function pickConfidence(ratio: number): Confidence {
  if (ratio >= 2.5) return { label: 'high', score: 0.9 };
  if (ratio >= 1.8) return { label: 'medium', score: 0.7 };
  return { label: 'low', score: 0.6 };
}

function weekKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-W${pad(getIsoWeek(d))}`;
}

function getIsoWeek(d: Date): number {
  const tmp = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  return Math.ceil(((tmp.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}
