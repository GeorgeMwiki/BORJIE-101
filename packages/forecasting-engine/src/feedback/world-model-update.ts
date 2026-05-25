/**
 * world-model-update — apply a predicted-actual delta back to the
 * world model's curves.
 *
 * Currently we only have hand-coded curves; this file is the future-
 * hook. It accepts a delta + a curve-id and emits a "curve-update
 * proposal" record that downstream learners will consume. Storing
 * the proposal here keeps the audit chain visible without coupling
 * to any specific store.
 */

import type { PredictedActualDelta } from '../types.js';

export interface CurveUpdateProposal {
  readonly forCurveId: string;
  readonly metric: string;
  readonly deltaRelative: number;
  readonly suggestedShift:
    | { kind: 'mean'; direction: 'up' | 'down'; magnitude: number }
    | { kind: 'variance'; widenBy: number }
    | { kind: 'noop' };
  readonly createdAtMs: number;
}

const VARIANCE_THRESHOLD = 0.4;
const MEAN_THRESHOLD = 0.15;

export function proposeCurveUpdate(
  curveId: string,
  delta: PredictedActualDelta,
  nowMs: number = Date.now(),
): CurveUpdateProposal {
  if (!delta.withinP10P90) {
    return {
      forCurveId: curveId,
      metric: delta.metric,
      deltaRelative: delta.relativeError,
      suggestedShift: { kind: 'variance', widenBy: delta.relativeError },
      createdAtMs: nowMs,
    };
  }
  if (delta.relativeError > MEAN_THRESHOLD) {
    return {
      forCurveId: curveId,
      metric: delta.metric,
      deltaRelative: delta.relativeError,
      suggestedShift: {
        kind: 'mean',
        direction: delta.actual > delta.predictedP50 ? 'up' : 'down',
        magnitude: Math.min(0.1, delta.relativeError * 0.2),
      },
      createdAtMs: nowMs,
    };
  }
  // VARIANCE_THRESHOLD is referenced for documentation; this exposed
  // path becomes active when learned curves can carry their own band
  // metadata. For now we fall through to noop when the prediction is
  // both in-band and accurate.
  void VARIANCE_THRESHOLD;
  return {
    forCurveId: curveId,
    metric: delta.metric,
    deltaRelative: delta.relativeError,
    suggestedShift: { kind: 'noop' },
    createdAtMs: nowMs,
  };
}
