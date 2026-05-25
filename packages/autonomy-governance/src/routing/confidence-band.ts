/**
 * Confidence-band routing — pure routing primitive.
 *
 * Three-band gate (per `.audit/litfin-sota-2026-05-23/
 * 10-outcome-as-a-service.md` §3.1):
 *
 *   confidence >= auto    → `auto`     (autonomous execute, no audit)
 *   confidence >= audit   → `audit`    (autonomous execute + audit queue)
 *   confidence <  audit   → `escalate` (do NOT execute; human-in-loop)
 *
 * The audit-and-escalate bands are the Klarna fingerprint defense — they
 * exist so edge-case low-confidence calls do not collapse into the
 * auto-execute lane (Klarna's ~5% long-tail hallucinations that drove the
 * 2025 reversal).
 *
 * Tier defaults are calibrated to risk-appetite per pricing tier:
 *   - `free`        strict   auto=0.99, audit=0.80 — tightest gate, lowest blast radius
 *   - `growth`      default  auto=0.95, audit=0.70 — matches spec headline
 *   - `enterprise`  permissive auto=0.90, audit=0.60 — operator carries the bag (BPO-style)
 *
 * Out of scope here: persistence of audit-queue entries, the actual
 * escalation handoff, cap-evaluator pre-check, and per-outcome-type
 * overrides. Wiring lives downstream.
 */

import type { Band, RouteDecision, TenantTier, TierThresholds } from './types.js';

/**
 * Default thresholds per tier. Frozen — never mutate at runtime.
 */
export const TIER_DEFAULTS: Readonly<Record<TenantTier, TierThresholds>> = Object.freeze({
  free: Object.freeze({ auto: 0.99, audit: 0.80 }),
  growth: Object.freeze({ auto: 0.95, audit: 0.70 }),
  enterprise: Object.freeze({ auto: 0.90, audit: 0.60 }),
});

/**
 * Spec-headline thresholds — kept as a separate constant for callers
 * that want the canonical "0.95 / 0.70" gate without a tier context.
 */
export const SPEC_DEFAULT_THRESHOLDS: Readonly<TierThresholds> = TIER_DEFAULTS.growth;

/**
 * Confidence-band router. Pure, total, deterministic.
 *
 * @param decision     Short human-readable label of what is being decided
 *                     (e.g. `"approve-refund:tenant=42"`). Embedded in the
 *                     verdict reason for audit-trail joinability.
 * @param confidence   Numeric confidence in [0, 1]. Out-of-range values
 *                     deterministically escalate (we never auto-execute on
 *                     a confidence we can't validate).
 * @param tierOrThresholds  Either a `TenantTier` (looked up in
 *                     `TIER_DEFAULTS`) or an explicit `TierThresholds`
 *                     override. Defaults to the spec headline gate.
 */
export function route(
  decision: string,
  confidence: number,
  tierOrThresholds: TenantTier | TierThresholds = SPEC_DEFAULT_THRESHOLDS,
): RouteDecision {
  const thresholds = resolveThresholds(tierOrThresholds);

  // Defence-in-depth: refuse to auto-execute on a confidence we can't
  // validate. NaN, infinities, and out-of-[0,1] values all escalate.
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    return {
      mode: 'escalate',
      reason: `escalate: invalid confidence=${String(confidence)} for "${decision}"`,
    };
  }

  if (!isValidThresholds(thresholds)) {
    // Misconfigured thresholds: we deliberately escalate (fail-safe) rather
    // than fall through to a band the operator did not intend.
    return {
      mode: 'escalate',
      reason: `escalate: invalid thresholds auto=${thresholds.auto} audit=${thresholds.audit} for "${decision}"`,
    };
  }

  const band = pickBand(confidence, thresholds);
  return {
    mode: band,
    reason: buildReason(band, decision, confidence, thresholds),
  };
}

function resolveThresholds(
  tierOrThresholds: TenantTier | TierThresholds,
): TierThresholds {
  if (typeof tierOrThresholds === 'string') {
    const fromTier = TIER_DEFAULTS[tierOrThresholds];
    // `TenantTier` is a closed union; this is defensive belt-and-braces.
    if (!fromTier) return SPEC_DEFAULT_THRESHOLDS;
    return fromTier;
  }
  return tierOrThresholds;
}

function isValidThresholds(t: TierThresholds): boolean {
  return (
    Number.isFinite(t.auto) &&
    Number.isFinite(t.audit) &&
    t.audit > 0 &&
    t.audit <= t.auto &&
    t.auto <= 1
  );
}

function pickBand(confidence: number, t: TierThresholds): Band {
  if (confidence >= t.auto) return 'auto';
  if (confidence >= t.audit) return 'audit';
  return 'escalate';
}

function buildReason(
  band: Band,
  decision: string,
  confidence: number,
  t: TierThresholds,
): string {
  const c = confidence.toFixed(4);
  switch (band) {
    case 'auto':
      return `auto: confidence=${c} >= auto-threshold=${t.auto} for "${decision}"`;
    case 'audit':
      return `audit: audit-threshold=${t.audit} <= confidence=${c} < auto-threshold=${t.auto} for "${decision}"`;
    case 'escalate':
      return `escalate: confidence=${c} < audit-threshold=${t.audit} for "${decision}"`;
  }
}
