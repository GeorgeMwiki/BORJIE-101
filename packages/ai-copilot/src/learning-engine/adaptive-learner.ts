/**
 * Adaptive Learner — tracks each user's mastery trajectory and adapts
 * content delivery to their detected learning style.
 *
 * Feeds off BKT mastery snapshots from classroom/group-bkt + style profiles
 * from learning-style-detector.
 */

import type { LearningStyle, LearningStyleProfile } from './learning-style-detector.js';

export interface MasteryPoint {
  readonly conceptId: string;
  readonly pKnow: number;
  readonly observations: number;
  readonly observedAt: string;
}

export interface MasteryTrajectory {
  readonly userId: string;
  readonly tenantId: string;
  readonly points: readonly MasteryPoint[];
}

export interface AdaptiveDeliveryChoice {
  readonly primaryModality: 'video' | 'reading' | 'hands-on' | 'conversation';
  readonly reinforcement: readonly ('quiz' | 'task' | 'discussion')[];
  readonly pacing: 'slow' | 'normal' | 'fast';
  readonly reasoning: string;
}

export interface AdaptiveRequest {
  readonly trajectory: MasteryTrajectory;
  readonly style: LearningStyleProfile;
  readonly targetConceptId: string;
  readonly averageDwellSecondsLastSession: number;
}

function modalityForStyle(style: LearningStyle): AdaptiveDeliveryChoice['primaryModality'] {
  switch (style) {
    case 'visual':
      return 'video';
    case 'verbal':
      return 'reading';
    case 'hands-on':
      return 'hands-on';
    case 'mixed':
    default:
      return 'conversation';
  }
}

function reinforcementForStyle(
  style: LearningStyle,
): AdaptiveDeliveryChoice['reinforcement'] {
  switch (style) {
    case 'visual':
      return ['quiz', 'task'];
    case 'verbal':
      return ['discussion', 'quiz'];
    case 'hands-on':
      return ['task', 'quiz'];
    case 'mixed':
    default:
      return ['quiz', 'discussion'];
  }
}

function computePacing(
  trajectory: MasteryTrajectory,
  conceptId: string,
  averageDwellSecondsLastSession: number,
): AdaptiveDeliveryChoice['pacing'] {
  const recent = trajectory.points
    .filter((p) => p.conceptId === conceptId)
    .slice(-3);
  if (recent.length === 0) return 'slow';
  const latest = recent[recent.length - 1]!;
  if (latest.pKnow > 0.85) return 'fast';
  if (averageDwellSecondsLastSession < 20) return 'fast';
  if (latest.pKnow < 0.4 || averageDwellSecondsLastSession > 120) return 'slow';
  return 'normal';
}

export function decideAdaptiveDelivery(
  request: AdaptiveRequest,
): AdaptiveDeliveryChoice {
  const primary = modalityForStyle(request.style.dominantStyle);
  const reinforcement = reinforcementForStyle(request.style.dominantStyle);
  const pacing = computePacing(
    request.trajectory,
    request.targetConceptId,
    request.averageDwellSecondsLastSession,
  );
  const reasoning = buildReasoning(request, primary, pacing);
  return { primaryModality: primary, reinforcement, pacing, reasoning };
}

function buildReasoning(
  request: AdaptiveRequest,
  primary: AdaptiveDeliveryChoice['primaryModality'],
  pacing: AdaptiveDeliveryChoice['pacing'],
): string {
  const styleLabel = request.style.dominantStyle;
  const confidencePct = Math.round(request.style.confidence * 100);
  return (
    `Detected ${styleLabel} style (${confidencePct}% confidence). Delivering ` +
    `primary as ${primary}. Pacing ${pacing} based on recent mastery and dwell.`
  );
}

export function calculateMasteryForecast(
  trajectory: MasteryTrajectory,
  conceptId: string,
  horizon: number,
): number {
  const points = trajectory.points
    .filter((p) => p.conceptId === conceptId)
    .slice(-5);
  if (points.length === 0) return 0;
  if (points.length === 1) return points[0]!.pKnow;
  const latest = points[points.length - 1]!.pKnow;
  const earliest = points[0]!.pKnow;
  const slope = (latest - earliest) / Math.max(1, points.length - 1);
  const forecast = latest + slope * horizon;
  return Math.max(0, Math.min(1, forecast));
}
