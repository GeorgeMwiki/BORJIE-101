/**
 * Cost-anomaly detector.
 *
 * Per-tenant AI cost surge. Flags when 7d cost > 1.5x baseline mean (a
 * 50% surge). Severity scales with the ratio; the autonomy-cap layer
 * caps absolute spend separately, but this surfaces *anomalies in
 * spending pattern* so the owner can ask "why".
 */
import type { AnomalyEvent, Confidence, Severity } from '../contracts/events.js';
import type { TickContext } from '../scheduler/tick-context.js';

const SURGE_FACTOR = 1.5;
const MIN_BASELINE_USD_CENTS = 100; // suppress noise if baseline < $1

export function detectCostAnomaly(ctx: TickContext): ReadonlyArray<AnomalyEvent> {
  const cost = ctx.inputs.cost;
  if (!cost || cost.tenantId !== ctx.tenantId) return [];
  if (cost.aiCostUsdCentsBaseline < MIN_BASELINE_USD_CENTS) return [];

  const ratio = cost.aiCostUsdCents7d / cost.aiCostUsdCentsBaseline;
  if (ratio < SURGE_FACTOR) return [];

  return [
    {
      type: 'anomaly',
      kind: 'cost-anomaly',
      id: `cost-anomaly:${cost.tenantId}:${weekKey(ctx.nowMs)}`,
      tenantId: ctx.tenantId,
      scope: ctx.scope,
      detectedAt: new Date(ctx.nowMs).toISOString(),
      confidence: pickConfidence(ratio),
      severity: pickSeverity(ratio),
      headline: `AI cost up ${((ratio - 1) * 100).toFixed(0)}% vs baseline ($${(cost.aiCostUsdCents7d / 100).toFixed(2)} this week).`,
      evidence: {
        aiCostUsdCents7d: cost.aiCostUsdCents7d,
        aiCostUsdCentsBaseline: cost.aiCostUsdCentsBaseline,
        ratio,
        surgeFactor: SURGE_FACTOR,
      },
    },
  ];
}

function pickSeverity(ratio: number): Severity {
  if (ratio >= 4) return 'P0';
  if (ratio >= 2.5) return 'P1';
  if (ratio >= 1.8) return 'P2';
  return 'P3';
}

function pickConfidence(ratio: number): Confidence {
  if (ratio >= 3) return { label: 'high', score: 0.9 };
  if (ratio >= 2) return { label: 'medium', score: 0.75 };
  return { label: 'low', score: 0.6 };
}

function weekKey(ms: number): string {
  const d = new Date(ms);
  const oneJan = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const day = Math.floor((d.getTime() - oneJan.getTime()) / 86_400_000);
  return `${d.getUTCFullYear()}-W${Math.ceil((day + oneJan.getUTCDay() + 1) / 7)}`;
}
