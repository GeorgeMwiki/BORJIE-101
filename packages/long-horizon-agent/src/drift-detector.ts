/**
 * Drift detector — Piece Q.
 *
 * Compares the current mission state against expectations and emits
 * `DriftSignal[]` for the checkpoint runner to attach to the next
 * `mission_checkpoints` row. The detector is pure (deterministic on
 * the inputs) so the same mission state produces the same signals.
 *
 * Detection rules:
 *   - deadline_slip    — expected_completion_date is in the past AND
 *                        any pending / in_progress steps remain.
 *   - budget_overrun   — spent_minor_units > budget_minor_units (>0).
 *   - step_replan      — any step with attempts >= 3 still pending /
 *                        in_progress (signal-but-no-mutation here; the
 *                        replan engine handles the actual mutation).
 *   - external_blocker — any step in 'blocked' status.
 *   - goal_shift       — never emitted by the detector; only human
 *                        edits trigger goal_shift drift events.
 *
 * Callers compose this with the checkpoint runner; the detector
 * itself does no persistence.
 */

import { type AgencyMission, type DriftSignal, type MissionStep } from './types.js';

const REPLAN_ATTEMPT_THRESHOLD = 3;

export interface DetectDriftArgs {
  readonly mission: AgencyMission;
  readonly steps: ReadonlyArray<MissionStep>;
  readonly nowIso: string;
}

export function detectDrift(args: DetectDriftArgs): ReadonlyArray<DriftSignal> {
  const signals: DriftSignal[] = [];

  // 1. deadline_slip
  if (
    args.mission.expectedCompletionDate !== null &&
    args.mission.status !== 'completed' &&
    args.mission.status !== 'abandoned'
  ) {
    const now = new Date(args.nowIso);
    const due = new Date(args.mission.expectedCompletionDate);
    if (Number.isFinite(due.getTime()) && due.getTime() < now.getTime()) {
      const pending = args.steps.some(
        (s) => s.status === 'pending' || s.status === 'in_progress',
      );
      if (pending) {
        signals.push({
          kind: 'deadline_slip',
          message: `Mission past expected_completion_date (${args.mission.expectedCompletionDate}) with pending steps`,
          observedAt: args.nowIso,
          details: {
            expectedCompletionDate: args.mission.expectedCompletionDate,
            nowIso: args.nowIso,
          },
        });
      }
    }
  }

  // 2. budget_overrun
  if (
    args.mission.budgetMinorUnits !== null &&
    args.mission.budgetMinorUnits > 0 &&
    args.mission.spentMinorUnits > args.mission.budgetMinorUnits
  ) {
    signals.push({
      kind: 'budget_overrun',
      message: `Spent ${args.mission.spentMinorUnits} minor units against budget ${args.mission.budgetMinorUnits}`,
      observedAt: args.nowIso,
      details: {
        spent: args.mission.spentMinorUnits,
        budget: args.mission.budgetMinorUnits,
      },
    });
  }

  // 3. step_replan
  for (const step of args.steps) {
    if (
      step.attempts >= REPLAN_ATTEMPT_THRESHOLD &&
      (step.status === 'pending' || step.status === 'in_progress')
    ) {
      signals.push({
        kind: 'step_replan',
        message: `Step ${step.id} has ${step.attempts} attempts without completing`,
        observedAt: args.nowIso,
        details: {
          stepId: step.id,
          ordinal: step.ordinal,
          attempts: step.attempts,
          status: step.status,
        },
      });
    }
  }

  // 4. external_blocker
  for (const step of args.steps) {
    if (step.status === 'blocked') {
      signals.push({
        kind: 'external_blocker',
        message: `Step ${step.id} is blocked`,
        observedAt: args.nowIso,
        details: {
          stepId: step.id,
          ordinal: step.ordinal,
        },
      });
    }
  }

  return signals;
}

/**
 * Sticky signal helper — collapses repeated detections of the same
 * (kind, stepId) into one entry by keeping the most-recent
 * observedAt. Used by the checkpoint runner to keep drift_signals_jsonb
 * compact.
 */
export function dedupeDriftSignals(
  signals: ReadonlyArray<DriftSignal>,
): ReadonlyArray<DriftSignal> {
  const byKey = new Map<string, DriftSignal>();
  for (const sig of signals) {
    const stepId =
      typeof sig.details['stepId'] === 'string'
        ? (sig.details['stepId'] as string)
        : '';
    const key = `${sig.kind}::${stepId}`;
    const prior = byKey.get(key);
    if (!prior || prior.observedAt < sig.observedAt) {
      byKey.set(key, sig);
    }
  }
  return Array.from(byKey.values());
}
