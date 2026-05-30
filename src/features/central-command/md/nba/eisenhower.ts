/**
 * Eisenhower-matrix classifier.
 *
 * Quadrants:
 *   - do-now:   urgent + important
 *   - schedule: important, not urgent
 *   - delegate: urgent, not important
 *   - drop:     neither
 *
 * Urgency comes from `contextualUrgencyLift` (driven by deadlines and
 * stale signals in the snapshot). Importance comes from baseline impact
 * plus contextual impact lift.
 *
 * Pure. No mutation.
 *
 * @module features/central-command/md/nba/eisenhower
 */

import { clamp, round } from "./ice-scorer";
import type {
  ActionCandidate,
  EisenhowerQuadrant,
  EisenhowerScore,
} from "./types";

const URGENT_THRESHOLD = 6;
const IMPORTANT_THRESHOLD = 6;

export function classifyEisenhower(
  candidate: ActionCandidate,
): EisenhowerScore {
  const urgencyScore = clamp(candidate.contextualUrgencyLift, 0, 10);
  const importanceScore = clamp(
    candidate.template.baselineImpact + candidate.contextualImpactLift,
    0,
    10,
  );

  const urgent = urgencyScore >= URGENT_THRESHOLD;
  const important = importanceScore >= IMPORTANT_THRESHOLD;
  const quadrant = quadrantFor(urgent, important);

  return Object.freeze({
    urgent,
    important,
    quadrant,
    urgencyScore: round(urgencyScore, 3),
    importanceScore: round(importanceScore, 3),
  });
}

function quadrantFor(urgent: boolean, important: boolean): EisenhowerQuadrant {
  if (urgent && important) return "do-now";
  if (!urgent && important) return "schedule";
  if (urgent && !important) return "delegate";
  return "drop";
}

/** Test helper — classify by raw scores. */
export function classifyByScores(
  urgencyScore: number,
  importanceScore: number,
): EisenhowerQuadrant {
  return quadrantFor(
    urgencyScore >= URGENT_THRESHOLD,
    importanceScore >= IMPORTANT_THRESHOLD,
  );
}

export const EISENHOWER_THRESHOLDS = Object.freeze({
  urgent: URGENT_THRESHOLD,
  important: IMPORTANT_THRESHOLD,
});
