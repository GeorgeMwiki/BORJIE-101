/**
 * Churn-risk detector.
 *
 * Per-customer-owner score combining:
 *   engagement decline (negative delta)
 *   + complaint frequency (past 30d)
 *   + payment lateness (latest invoice)
 *
 * Score = weighted sum normalised to [0,1]. >= 0.6 flags risk.
 * Runs on platform-internal scope (HQ admin view of churn risk for the
 * customer-owners of the SaaS) AND tenant scope (the owner's own
 * tenants — different `customerOwners` payload, same algorithm).
 */
import type { AnomalyEvent, Confidence, Severity } from '../contracts/events.js';
import type { TickContext } from '../scheduler/tick-context.js';
import type { CustomerOwnerSignal } from '../contracts/forecast-input.js';

const RISK_THRESHOLD = 0.6;

const WEIGHTS = {
  engagement: 0.4,
  complaints: 0.35,
  lateness: 0.25,
} as const;

export function detectChurnRisk(ctx: TickContext): ReadonlyArray<AnomalyEvent> {
  const signals = ctx.inputs.customerOwners ?? [];
  const out: AnomalyEvent[] = [];

  for (const sig of signals) {
    const score = scoreSignal(sig);
    if (score < RISK_THRESHOLD) continue;
    out.push(toEvent(ctx, sig, score));
  }
  return out;
}

function scoreSignal(sig: CustomerOwnerSignal): number {
  const engagement = clamp01(-sig.engagementDelta); // declines yield positive risk
  const complaints = clamp01(sig.complaintCount30d / 5); // 5 complaints -> max
  const lateness = Number.isFinite(sig.latestPaymentLatenessDays)
    ? clamp01(sig.latestPaymentLatenessDays / 30) // 30 days late -> max
    : 0;
  return (
    WEIGHTS.engagement * engagement +
    WEIGHTS.complaints * complaints +
    WEIGHTS.lateness * lateness
  );
}

function toEvent(
  ctx: TickContext,
  sig: CustomerOwnerSignal,
  score: number,
): AnomalyEvent {
  const severity = pickSeverity(score);
  const confidence = pickConfidence(score);
  return {
    type: 'anomaly',
    kind: 'churn-risk',
    id: `churn-risk:${ctx.tenantId ?? 'platform'}:${sig.customerOwnerId}`,
    tenantId: ctx.tenantId,
    scope: ctx.scope,
    detectedAt: new Date(ctx.nowMs).toISOString(),
    confidence,
    severity,
    headline: `${sig.customerOwnerId} shows churn risk score ${score.toFixed(2)} (engagement ${(sig.engagementDelta * 100).toFixed(0)}% wow).`,
    evidence: {
      customerOwnerId: sig.customerOwnerId,
      score,
      engagement30d: sig.engagement30d,
      engagementDelta: sig.engagementDelta,
      complaintCount30d: sig.complaintCount30d,
      latestPaymentLatenessDays: sig.latestPaymentLatenessDays,
    },
  };
}

function pickSeverity(score: number): Severity {
  if (score >= 0.85) return 'P0';
  if (score >= 0.75) return 'P1';
  if (score >= 0.65) return 'P2';
  return 'P3';
}

function pickConfidence(score: number): Confidence {
  if (score >= 0.8) return { label: 'high', score };
  if (score >= 0.7) return { label: 'medium', score };
  return { label: 'low', score };
}

function clamp01(n: number): number {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
