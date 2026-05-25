/**
 * Vendor-reliability-drop detector.
 *
 * Compares this 90d on-time rate to the prior 90d window. A drop of
 * more than 10 percentage points (and at least a 15% relative drop)
 * flags the vendor. The opportunity-side counterpart
 * (vendor-rate-arbitrage) handles "you could pay less elsewhere" —
 * this side handles "they're getting worse".
 */
import type { AnomalyEvent, Confidence, Severity } from '../contracts/events.js';
import type { TickContext } from '../scheduler/tick-context.js';

const ABS_DROP_THRESHOLD = 0.10; // 10 percentage points
const REL_DROP_THRESHOLD = 0.15; // 15% relative

export function detectVendorReliabilityDrop(
  ctx: TickContext,
): ReadonlyArray<AnomalyEvent> {
  const vendors = ctx.inputs.vendors ?? [];
  const out: AnomalyEvent[] = [];

  for (const v of vendors) {
    if (v.tenantId !== ctx.tenantId) continue;
    const absDrop = v.onTimeRatePrior - v.onTimeRate90d;
    const relDrop =
      v.onTimeRatePrior <= 0
        ? 0
        : (v.onTimeRatePrior - v.onTimeRate90d) / v.onTimeRatePrior;
    if (absDrop < ABS_DROP_THRESHOLD) continue;
    if (relDrop < REL_DROP_THRESHOLD) continue;

    out.push({
      type: 'anomaly',
      kind: 'vendor-reliability-drop',
      id: `vendor-reliability:${v.tenantId}:${v.vendorId}`,
      tenantId: ctx.tenantId,
      scope: ctx.scope,
      detectedAt: new Date(ctx.nowMs).toISOString(),
      confidence: pickConfidence(absDrop),
      severity: pickSeverity(absDrop),
      headline: `${v.vendorName} on-time dropped from ${(v.onTimeRatePrior * 100).toFixed(0)}% to ${(v.onTimeRate90d * 100).toFixed(0)}%.`,
      evidence: {
        vendorId: v.vendorId,
        vendorName: v.vendorName,
        onTimeRate90d: v.onTimeRate90d,
        onTimeRatePrior: v.onTimeRatePrior,
        absDrop,
        relDrop,
      },
    });
  }
  return out;
}

function pickSeverity(absDrop: number): Severity {
  if (absDrop >= 0.4) return 'P0';
  if (absDrop >= 0.25) return 'P1';
  if (absDrop >= 0.15) return 'P2';
  return 'P3';
}

function pickConfidence(absDrop: number): Confidence {
  if (absDrop >= 0.3) return { label: 'high', score: 0.85 };
  if (absDrop >= 0.2) return { label: 'medium', score: 0.7 };
  return { label: 'low', score: 0.55 };
}
