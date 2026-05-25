/**
 * Mastery-gate bridge.
 *
 * The chat-ui package owns the canonical mastery tracker
 * (`packages/chat-ui/src/lib/user-mastery/`) and the user_action_tracker
 * table (migration 0183). Each correct / incorrect tutor outcome maps
 * onto a `UserActionEvent` so the existing MasteryGate / UI-3 layer
 * automatically lifts the learner to the next tier when their
 * weighted score crosses a threshold.
 *
 * We intentionally do NOT import @borjie/chat-ui — that package
 * pulls React and would inflate this server-side library. Instead we
 * accept an adapter the composition root wires up.
 *
 * Action ids follow the naming convention `tutor.<concept_slug>.<outcome>`
 * so the existing distinct-actions count carries useful signal:
 *   tutor.net_operating_income.correct
 *   tutor.net_operating_income.incorrect
 *
 * If no recorder is wired, the orchestrator runs in fallback mode
 * (single-pass lesson, no progression) per the Piece H spec.
 */

import type { MasteryRecorder } from './types.js';

/**
 * Build the action id for a tutor outcome. Used both by the
 * orchestrator (when recording) and by analytics / dashboards (when
 * counting correct answers per concept).
 */
export function tutorActionId(
  conceptSlug: string,
  outcome: 'correct' | 'incorrect',
): string {
  return `tutor.${conceptSlug}.${outcome}`;
}

/**
 * Wire a MasteryRecorder against an arbitrary
 * `userActionEvent → Promise<void>` flusher. The chat-ui mastery
 * tracker's `recordUserAction` matches that shape; the composition
 * root can bind it directly.
 */
export function makeMasteryRecorder(
  flushUserAction: (event: {
    readonly tenantId: string;
    readonly userId: string;
    readonly actionId: string;
  }) => Promise<void>,
): MasteryRecorder {
  return {
    record: async (input) => {
      await flushUserAction({
        tenantId: input.tenantId,
        userId: input.userId,
        actionId: tutorActionId(input.conceptSlug, input.outcome),
      });
    },
  };
}

/** Null-object recorder used when no real mastery layer is wired. */
export const noopMasteryRecorder: MasteryRecorder = {
  record: async () => {
    // Intentional no-op.
  },
};

/**
 * Inspect an in-memory event flush log for a given (tenant, user,
 * concept) and report counts. Used by tests; production reads the
 * user_action_tracker table directly.
 */
export function summariseLessonOutcomes(
  events: ReadonlyArray<{
    readonly tenantId: string;
    readonly userId: string;
    readonly actionId: string;
  }>,
  filter: {
    readonly tenantId: string;
    readonly userId: string;
    readonly conceptSlug: string;
  },
): { readonly correct: number; readonly incorrect: number } {
  const expectCorrect = tutorActionId(filter.conceptSlug, 'correct');
  const expectIncorrect = tutorActionId(filter.conceptSlug, 'incorrect');
  let correct = 0;
  let incorrect = 0;
  for (const e of events) {
    if (e.tenantId !== filter.tenantId || e.userId !== filter.userId) continue;
    if (e.actionId === expectCorrect) correct++;
    else if (e.actionId === expectIncorrect) incorrect++;
  }
  return { correct, incorrect };
}
