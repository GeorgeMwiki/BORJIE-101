/**
 * reflexion-update — convert a predicted-actual delta into a lesson.
 *
 * The MD's reflexion buffer is a downstream concern; this module
 * produces the lesson record. The agent-platform call site routes it
 * to wherever lessons live (memory, KV, etc.).
 */

import type { PredictedActualDelta, ReflexionLesson } from '../types.js';

const LARGE_RELATIVE_ERROR = 0.25;

export function lessonFromDelta(
  delta: PredictedActualDelta,
  nowMs: number = Date.now(),
): ReflexionLesson | null {
  // No lesson if the prediction was within band.
  if (delta.withinP10P90 && delta.relativeError < LARGE_RELATIVE_ERROR) {
    return null;
  }

  const direction =
    delta.actual > delta.predictedP50 ? 'underestimated' : 'overestimated';
  const summary = `${delta.metric}: ${direction} actual (predicted ${delta.predictedP50.toFixed(
    2,
  )} vs actual ${delta.actual.toFixed(2)}, relErr ${(delta.relativeError * 100).toFixed(1)}%)`;

  let correctionHint: string;
  if (!delta.withinP10P90) {
    correctionHint = `Widen confidence band for ${delta.metric}; residual variance is larger than the current model expects.`;
  } else {
    correctionHint = `Re-tune ${delta.metric} central estimate; bias is ${direction === 'underestimated' ? 'low' : 'high'}.`;
  }

  return {
    id: `lesson_${delta.predictionId}`,
    forMetric: delta.metric,
    summary,
    correctionHint,
    createdAt: nowMs,
  };
}
