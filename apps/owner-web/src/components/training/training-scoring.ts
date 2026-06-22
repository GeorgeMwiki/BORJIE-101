/**
 * Pure, dependency-free helpers shared by the training surfaces (gap 9 + 10).
 *
 * Kept tiny so both the scenario-simulation surface and the mastery-checkpoint
 * surface reuse one source of truth. No Swahili literals live here (the
 * locale-purity guard scans this file); all copy is resolved through
 * `i18n/strings/training.ts`.
 */

import type { ScenarioLanguage } from '@borjie/api-client/training-types';

/** Narrow the owner-session locale to the two the training surfaces support. */
export function toTrainingLanguage(locale: string): ScenarioLanguage {
  return locale === 'sw' ? 'sw' : 'en';
}

/** mm:ss elapsed-time render for the decision-capture timer. */
export function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Map a run's objective coverage + elapsed time to a score in [0, 1].
 *
 * Coverage is the dominant signal (80%): how many of the briefing's grounded
 * objectives the operator surfaced. A small timing bonus (20%) rewards a run
 * completed within the scenario's estimated minutes. Deterministic — the same
 * inputs always yield the same score.
 */
export function computeRunScore(
  objectivesCovered: number,
  objectivesTotal: number,
  elapsedMs: number,
  estimatedMinutes: number,
): number {
  if (objectivesTotal <= 0) return 0;
  const coverage = Math.min(1, objectivesCovered / objectivesTotal);
  const budgetMs = Math.max(1, estimatedMinutes * 60 * 1000);
  const timeRatio = Math.min(1, elapsedMs / budgetMs);
  const timingBonus = 1 - timeRatio; // faster than budget -> closer to 1
  const score = coverage * 0.8 + timingBonus * 0.2;
  return Math.max(0, Math.min(1, Number(score.toFixed(4))));
}

/** Difficulty → DS semantic chip classes (success / warning / danger). */
export function difficultyChipClass(difficulty: string): string {
  if (difficulty === 'advanced') {
    return 'border-danger/40 bg-danger-subtle text-danger';
  }
  if (difficulty === 'intermediate') {
    return 'border-warning/40 bg-warning-subtle text-warning';
  }
  return 'border-success/40 bg-success-subtle text-success';
}
