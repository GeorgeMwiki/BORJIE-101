/**
 * Fatigue policy — pure function.
 *
 * `applyFatigue(recommendation, history)` returns either an adjusted
 * recommendation (priority downgraded, confidence dampened) or `null`
 * if the recommendation should be dropped this tick.
 *
 * Algorithm (ratchet):
 *   - 3 consecutive ignores of same kind     -> drop this tick
 *   - 5 consecutive declines of same kind    -> drop this tick
 *   - 3 consecutive approvals of same kind   -> trust boost: bump
 *                                               severity up one tier
 *                                               (capped at P1; P0
 *                                                stays at P0)
 *   - else                                   -> emit as-is
 *
 * Note: trust boost is capped at P1 — never auto-elevate to P0. The
 * autonomy-cap layer is the only path to P0-style escalation.
 */
import type { Severity } from '../contracts/events.js';
import type { Recommendation } from '../recommendations/recommendation-types.js';
import type { FatigueHistory, Outcome } from './fatigue-tracker.js';

const IGNORE_RUN_DROP = 3;
const DECLINE_RUN_DROP = 5;
const APPROVE_RUN_BOOST = 3;

export interface FatigueDecision {
  readonly outcome: 'emit' | 'drop' | 'boost' | 'downgrade';
  readonly reason: string;
  readonly recommendation: Recommendation | null;
}

export function applyFatigue(
  recommendation: Recommendation,
  history: FatigueHistory,
): FatigueDecision {
  const run = consecutiveRun(history.recent);

  if (run.outcome === 'ignored' && run.length >= IGNORE_RUN_DROP) {
    return {
      outcome: 'drop',
      reason: `Ignored ${run.length}x in a row — suppressing this tick.`,
      recommendation: null,
    };
  }
  if (run.outcome === 'declined' && run.length >= DECLINE_RUN_DROP) {
    return {
      outcome: 'drop',
      reason: `Declined ${run.length}x in a row — suppressing this tick.`,
      recommendation: null,
    };
  }
  if (run.outcome === 'approved' && run.length >= APPROVE_RUN_BOOST) {
    return {
      outcome: 'boost',
      reason: `Approved ${run.length}x in a row — trust boost applied.`,
      recommendation: boost(recommendation),
    };
  }
  // If we have ignores < drop threshold but >= 1, downgrade priority.
  if (run.outcome === 'ignored' && run.length >= 1) {
    return {
      outcome: 'downgrade',
      reason: `Recent ignore — priority dampened.`,
      recommendation: downgrade(recommendation),
    };
  }
  return {
    outcome: 'emit',
    reason: 'within fatigue tolerances',
    recommendation,
  };
}

interface RunInfo {
  readonly outcome: Outcome | null;
  readonly length: number;
}

function consecutiveRun(recent: ReadonlyArray<Outcome>): RunInfo {
  if (recent.length === 0) return { outcome: null, length: 0 };
  const head = recent[0];
  if (head === undefined) return { outcome: null, length: 0 };
  let length = 0;
  for (const o of recent) {
    if (o === head) length += 1;
    else break;
  }
  return { outcome: head, length };
}

function boost(rec: Recommendation): Recommendation {
  return {
    ...rec,
    severity: boostSeverity(rec.severity),
    confidence: {
      ...rec.confidence,
      score: clamp01(rec.confidence.score + 0.05),
    },
  };
}

function downgrade(rec: Recommendation): Recommendation {
  return {
    ...rec,
    severity: downgradeSeverity(rec.severity),
    confidence: {
      ...rec.confidence,
      score: clamp01(rec.confidence.score - 0.05),
    },
  };
}

function boostSeverity(s: Severity): Severity {
  if (s === 'P3') return 'P2';
  if (s === 'P2') return 'P1';
  return s; // P1 and P0 never auto-boost further
}

function downgradeSeverity(s: Severity): Severity {
  if (s === 'P0') return 'P1';
  if (s === 'P1') return 'P2';
  if (s === 'P2') return 'P3';
  return 'P3';
}

function clamp01(n: number): number {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
