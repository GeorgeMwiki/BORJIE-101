/**
 * Market regime detector — classifies the agency-level state vector
 * series into a coarse market regime: stable / tightening / loosening
 * / shock. The kernel uses this to choose between conservative and
 * aggressive recommendations (e.g. push rents in `loosening`, hold
 * rents flat in `tightening`).
 *
 * Heuristics:
 *   - tightening  occupancy down >5% over 90d  AND  rent stable/falling
 *   - loosening   occupancy up                 AND  arrears falling
 *   - shock       occupancy or rent moves >15% in either direction in 30d
 *   - stable      otherwise (also the default when history is too short)
 *
 * Inputs are deliberately the agency-level vector — a roll-up across
 * the whole tenant org. Per-property regimes are surfaced via the
 * trajectory module's PropertyRegime instead.
 *
 * Pure module — no I/O, no clock dependency, no mutation. The caller
 * supplies the history; freshness is its problem, not ours.
 */

import type { AgencyState } from './state-vectors.js';

// ─────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────

export type MarketRegime = 'stable' | 'tightening' | 'loosening' | 'shock';

export interface RegimeSignal {
  readonly regime: MarketRegime;
  readonly evidence: ReadonlyArray<string>;       // human-readable
  readonly confidence: number;
}

export interface DetectMarketRegimeArgs {
  readonly portfolio: AgencyState;
  readonly history: ReadonlyArray<AgencyState>;
}

// ─────────────────────────────────────────────────────────────────────
// Tunables — pulled out so a test or a future learned model can shadow
// them with a different policy.
// ─────────────────────────────────────────────────────────────────────

const SHOCK_WINDOW_DAYS = 30;
const TIGHTENING_WINDOW_DAYS = 90;
const SHOCK_RELATIVE_MOVE = 0.15;       // 15%
const TIGHTENING_OCCUPANCY_DROP = 0.05; // 5pp
const RENT_STABLE_TOLERANCE = 0.02;     // ±2% counts as stable

// ─────────────────────────────────────────────────────────────────────
// Helpers — pure, immutable.
// ─────────────────────────────────────────────────────────────────────

function daysBetween(earlier: string, later: string): number {
  const a = Date.parse(earlier);
  const b = Date.parse(later);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.abs(b - a) / (1000 * 60 * 60 * 24);
}

function rentMajorPerLease(s: AgencyState): number {
  if (s.activeLeases === 0) return 0;
  return s.aiCostMajorLast30d / s.activeLeases;
}

/**
 * Average occupancy proxy for an AgencyState. The vector itself does
 * not carry occupancy; we proxy via active-leases as a proportion of
 * (active leases + work orders that signal vacancy churn). This is a
 * deliberately rough proxy — the real signal arrives when the kernel
 * is bound to a richer agency-level rollup.
 *
 * Returning 0 when no active leases keeps downstream divisions safe.
 */
function activityScore(s: AgencyState): number {
  return s.activeLeases;
}

interface NearestObservationOpts {
  readonly target: AgencyState;
  readonly history: ReadonlyArray<AgencyState>;
  readonly approxDaysAgo: number;
}

/**
 * Find the historical observation closest in time to `approxDaysAgo`
 * before `target`. Returns null when the history is empty.
 */
function nearestObservationBefore(
  opts: NearestObservationOpts,
): AgencyState | null {
  if (opts.history.length === 0) return null;
  let best: AgencyState | null = null;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const s of opts.history) {
    const dt = daysBetween(s.observedAt, opts.target.observedAt);
    const delta = Math.abs(dt - opts.approxDaysAgo);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = s;
    }
  }
  return best;
}

function relativeChange(a: number, b: number): number {
  if (a === 0) return b === 0 ? 0 : Number.POSITIVE_INFINITY;
  return (b - a) / Math.abs(a);
}

// ─────────────────────────────────────────────────────────────────────
// Detector
// ─────────────────────────────────────────────────────────────────────

export function detectMarketRegime(
  args: DetectMarketRegimeArgs,
): RegimeSignal {
  const { portfolio, history } = args;
  const evidence: string[] = [];

  // Insufficient history → fall back to stable, but say so.
  if (history.length < 2) {
    evidence.push(
      `insufficient history (${history.length} observations); defaulting to stable`,
    );
    return Object.freeze({
      regime: 'stable',
      evidence: Object.freeze(evidence),
      confidence: 0.4,
    });
  }

  const obs30 = nearestObservationBefore({
    target: portfolio,
    history,
    approxDaysAgo: SHOCK_WINDOW_DAYS,
  });
  const obs90 = nearestObservationBefore({
    target: portfolio,
    history,
    approxDaysAgo: TIGHTENING_WINDOW_DAYS,
  });

  // ── shock check (run first; dominates other classifications) ──────
  if (obs30) {
    const occChange = relativeChange(activityScore(obs30), activityScore(portfolio));
    const rentChange = relativeChange(rentMajorPerLease(obs30), rentMajorPerLease(portfolio));
    if (Math.abs(occChange) > SHOCK_RELATIVE_MOVE) {
      evidence.push(
        `activity moved ${(occChange * 100).toFixed(1)}% in last ${SHOCK_WINDOW_DAYS}d`,
      );
    }
    if (Math.abs(rentChange) > SHOCK_RELATIVE_MOVE) {
      evidence.push(
        `rent-per-lease moved ${(rentChange * 100).toFixed(1)}% in last ${SHOCK_WINDOW_DAYS}d`,
      );
    }
    if (
      Math.abs(occChange) > SHOCK_RELATIVE_MOVE ||
      Math.abs(rentChange) > SHOCK_RELATIVE_MOVE
    ) {
      return Object.freeze({
        regime: 'shock',
        evidence: Object.freeze(evidence),
        confidence: 0.85,
      });
    }
  }

  // ── tightening / loosening (require 90d-ago anchor) ───────────────
  if (obs90) {
    const occChange90 = relativeChange(activityScore(obs90), activityScore(portfolio));
    const rentChange90 = relativeChange(rentMajorPerLease(obs90), rentMajorPerLease(portfolio));

    // Tightening: occupancy fell, rent didn't surge.
    if (
      occChange90 < -TIGHTENING_OCCUPANCY_DROP &&
      rentChange90 <= RENT_STABLE_TOLERANCE
    ) {
      evidence.push(
        `activity fell ${(occChange90 * 100).toFixed(1)}% over 90d`,
      );
      evidence.push(
        `rent-per-lease moved ${(rentChange90 * 100).toFixed(1)}% (≤ stable tolerance)`,
      );
      return Object.freeze({
        regime: 'tightening',
        evidence: Object.freeze(evidence),
        confidence: 0.7,
      });
    }

    // Loosening: occupancy rose AND we have a falling work-order
    // backlog signal (proxy for falling arrears since the agency
    // vector doesn't carry arrears directly).
    const workOrderChange = relativeChange(
      obs90.activeWorkOrders,
      portfolio.activeWorkOrders,
    );
    if (occChange90 > 0 && workOrderChange < 0) {
      evidence.push(
        `activity rose ${(occChange90 * 100).toFixed(1)}% over 90d`,
      );
      evidence.push(
        `work-order backlog fell ${(workOrderChange * 100).toFixed(1)}% over 90d`,
      );
      return Object.freeze({
        regime: 'loosening',
        evidence: Object.freeze(evidence),
        confidence: 0.65,
      });
    }
  }

  // ── default ───────────────────────────────────────────────────────
  evidence.push('no qualifying tightening/loosening/shock signal');
  return Object.freeze({
    regime: 'stable',
    evidence: Object.freeze(evidence),
    confidence: 0.6,
  });
}
