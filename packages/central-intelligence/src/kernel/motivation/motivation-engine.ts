/**
 * Motivation engine — runs the standing DRIVES over a situational snapshot and
 * formulates a goal for every UNSATISFIED drive, with NO incoming trigger.
 *
 * This is the pure heart of "identify loops the user has no idea about": the
 * estate's standing concerns are continuously evaluated, and a breach becomes
 * a self-formulated `MotivatedGoal` keyed by the drive (so the same concern
 * coalesces tick-over-tick rather than spamming). The engine NEVER acts and
 * NEVER touches money/licence/deletion — it only proposes a goal seed the
 * EstateMind loop turns into a gated nudge.
 *
 * Pure + deterministic: same snapshot + thresholds + clock → same goals.
 */

import type { SituationalSnapshot } from '../situational-model/types.js';
import type {
  Drive,
  DriveAssessment,
  DriveThresholds,
  MotivatedGoal,
} from './types.js';
import { DEFAULT_DRIVES } from './default-drives.js';

export interface MotivationEngineDeps {
  /** Drive set to evaluate. Defaults to the six standing estate drives. */
  readonly drives?: ReadonlyArray<Drive>;
  /** Per-tenant thresholds. Empty → built-in defaults per drive. */
  readonly thresholds?: DriveThresholds;
  /** Injectable clock for deterministic `formulatedAtMs`. */
  readonly now?: () => number;
}

export interface MotivationEngine {
  /** Evaluate every drive against the snapshot (satisfied + unsatisfied). */
  assess(snapshot: SituationalSnapshot): ReadonlyArray<DriveAssessment>;
  /**
   * Formulate one goal per UNSATISFIED drive. Goals are returned
   * highest-severity-first so the loop can surface the most-pressing concern
   * as the Global-Workspace broadcast.
   */
  formulateGoals(snapshot: SituationalSnapshot): ReadonlyArray<MotivatedGoal>;
}

export function createMotivationEngine(
  deps: MotivationEngineDeps = {},
): MotivationEngine {
  const drives = deps.drives ?? DEFAULT_DRIVES;
  const thresholds = deps.thresholds ?? {};
  const now = deps.now ?? (() => Date.now());

  function assess(
    snapshot: SituationalSnapshot,
  ): ReadonlyArray<DriveAssessment> {
    return drives.map((drive) => {
      // Defensive: a drive evaluator is pure by contract, but a future
      // custom drive could throw; treat a throwing drive as SATISFIED (never
      // let one bad drive break the whole motivational pass) and move on.
      try {
        return drive.evaluate(snapshot, thresholds);
      } catch {
        return {
          driveId: drive.id,
          satisfied: true,
          breachSeverity: 0,
          urgency: 'low' as const,
          summary: 'evaluator error — treated as satisfied',
          evidence: [],
        };
      }
    });
  }

  function formulateGoals(
    snapshot: SituationalSnapshot,
  ): ReadonlyArray<MotivatedGoal> {
    const formulatedAtMs = now();
    const goals: MotivatedGoal[] = [];
    for (const assessment of assess(snapshot)) {
      if (assessment.satisfied) continue;
      goals.push(
        Object.freeze({
          tenantId: snapshot.tenantId,
          id: `drive:${assessment.driveId}`,
          driveId: assessment.driveId,
          title: titleFor(assessment),
          rationale: assessment.summary,
          urgency: assessment.urgency,
          breachSeverity: assessment.breachSeverity,
          evidence: assessment.evidence,
          formulatedAtMs,
        }),
      );
    }
    goals.sort((a, b) => b.breachSeverity - a.breachSeverity);
    return Object.freeze(goals);
  }

  return { assess, formulateGoals };
}

function titleFor(assessment: DriveAssessment): string {
  switch (assessment.driveId) {
    case 'cash-runway':
      return 'Cash runway needs attention';
    case 'licence-currency':
      return 'Licence renewal is approaching';
    case 'safety':
      return 'Open safety incident needs action';
    case 'offtake-coverage':
      return 'Off-take coverage is short';
    case 'royalty-currency':
      return 'Royalty / receivables are overdue';
    case 'equipment-health':
      return 'Equipment health is degraded';
    default:
      return 'Standing concern breached';
  }
}
