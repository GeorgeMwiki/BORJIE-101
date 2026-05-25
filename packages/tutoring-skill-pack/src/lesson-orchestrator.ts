/**
 * Lesson orchestrator — exposes `runLesson` for one-shot use and
 * `LessonSession` for the interactive case (UI streams events,
 * collects learner replies, drives the state machine).
 *
 * Composition:
 *   - state-machine.ts        — pure transitions
 *   - data-grounding.ts        — pull live tenant data → worked example
 *   - mastery-gate-integration — record outcomes to user_action_tracker
 *
 * The orchestrator returns events typed by step. UIs render each event
 * and post the learner's reply (if any) to advance the session.
 */

import {
  initialState,
  advance,
  isDontGetIt,
  pickCitationFocus,
} from './state-machine.js';
import { groundWorkedExample } from './data-grounding.js';
import { noopMasteryRecorder } from './mastery-gate-integration.js';
import type {
  LessonState,
  LessonEvent,
  LessonEngineDeps,
  RunLessonInput,
  TutoringConcept,
  DataCitation,
} from './types.js';
import { TutoringEngineError } from './types.js';

/** One interactive session. Hold across multiple `advance` calls. */
export class LessonSession {
  private _state: LessonState;
  private readonly concept: TutoringConcept;
  private readonly groundedExample: {
    readonly prompt: string;
    readonly answer: string;
    readonly explanation: string;
    readonly citations: readonly DataCitation[];
  };
  private readonly deps: LessonEngineDeps;

  constructor(input: {
    readonly concept: TutoringConcept;
    readonly groundedExample: {
      readonly prompt: string;
      readonly answer: string;
      readonly explanation: string;
      readonly citations: readonly DataCitation[];
    };
    readonly state: LessonState;
    readonly deps: LessonEngineDeps;
  }) {
    this.concept = input.concept;
    this.groundedExample = input.groundedExample;
    this._state = {
      ...input.state,
      citations: input.groundedExample.citations,
    };
    this.deps = input.deps;
  }

  get state(): LessonState {
    return this._state;
  }

  /** Emit the event for the current step (no learner input required). */
  describeCurrent(): LessonEvent {
    return renderEvent(
      this._state,
      this.concept,
      this.groundedExample,
      null,
    );
  }

  /**
   * Submit a learner reply and advance the state machine. Returns the
   * event for the new step (which the UI should render next). May
   * also flush mastery events as a side effect.
   */
  async submit(reply: string | null): Promise<LessonEvent> {
    // Record mastery before transitioning (we look at the OUTCOME of
    // the just-finished step, not the new one).
    if (this._state.step === 'check_understanding' && reply != null) {
      await this.maybeRecordCheckOutcome(reply);
    }

    const next = advance(this._state, reply, this.concept);
    this._state = { ...next, citations: this.groundedExample.citations };
    return renderEvent(
      this._state,
      this.concept,
      this.groundedExample,
      reply,
    );
  }

  private async maybeRecordCheckOutcome(reply: string): Promise<void> {
    if (isDontGetIt(reply)) return;
    const check = this.concept.content.check_understanding[
      this._state.checkIndex
    ];
    if (!check) return;
    // Lazy import to avoid a static cycle if a consumer uses the
    // state-machine module directly.
    const { scoreCheckAnswer } = await import('./state-machine.js');
    const outcome = scoreCheckAnswer(reply, check);
    const recorder = this.deps.masteryRecorder ?? noopMasteryRecorder;
    try {
      await recorder.record({
        tenantId: this._state.tenantId,
        userId: this._state.userId,
        conceptSlug: this._state.conceptSlug,
        outcome,
      });
    } catch {
      // Mastery recording is best-effort. A failure here MUST NOT
      // break the lesson.
    }
  }
}

function renderEvent(
  state: LessonState,
  concept: TutoringConcept,
  grounded: {
    readonly prompt: string;
    readonly answer: string;
    readonly explanation: string;
    readonly citations: readonly DataCitation[];
  },
  lastReply: string | null,
): LessonEvent {
  const checkIdx = state.checkIndex;
  const checks = concept.content.check_understanding;

  switch (state.step) {
    case 'assess':
      return {
        step: 'assess',
        message: `Let's check what you know about ${conceptTitle(concept, state.locale)}. What does this term mean to you so far?`,
        waitingForLearner: true,
      };
    case 'hook':
      return {
        step: 'hook',
        message: concept.content.hook,
        waitingForLearner: false,
      };
    case 'explain':
      return {
        step: 'explain',
        message:
          concept.content.definition +
          (concept.content.formula
            ? `\n\nFormula: ${concept.content.formula}`
            : ''),
        waitingForLearner: false,
      };
    case 'worked_example':
      return {
        step: 'worked_example',
        message:
          `Worked example:\n${grounded.prompt}\n\nAnswer: ${grounded.answer}\n\n${grounded.explanation}`,
        waitingForLearner: false,
        citations: grounded.citations,
      };
    case 'check_understanding': {
      const current = checks[checkIdx];
      if (!current) {
        return {
          step: 'check_understanding',
          message: 'No further checks for this concept.',
          waitingForLearner: false,
        };
      }
      // If the learner just got it wrong (attempts > 0), prepend hint
      // before re-asking.
      const prefix =
        state.attempts > 0
          ? `Not quite. Hint: ${current.hint}\n\n`
          : '';
      return {
        step: 'check_understanding',
        message: `${prefix}${current.question}`,
        waitingForLearner: true,
      };
    }
    case 'remediate': {
      // Branch the explanation to whatever the learner is confused about.
      const focus = lastReply
        ? pickCitationFocus(lastReply, concept)
        : null;
      const citation = focus
        ? grounded.citations.find((c) => c.key === focus)
        : undefined;
      const detail = citation
        ? `Specifically: ${focus} was ${citation.value} (source ${citation.sourceRef}).`
        : `Let's unpack one piece at a time.`;
      return {
        step: 'remediate',
        message: `${detail}\n\n${concept.content.definition}`,
        waitingForLearner: false,
      };
    }
    case 'mastery': {
      const passed =
        state.correctCount >=
        (concept.masteryThresholds.beginner?.min_correct ?? 1);
      return {
        step: 'mastery',
        message: passed
          ? `Nice — ${state.correctCount} correct. You've cleared the beginner threshold for ${conceptTitle(concept, state.locale)}.`
          : `Logged ${state.correctCount} correct / ${state.incorrectCount} incorrect. Try this lesson again later to build mastery.`,
        waitingForLearner: false,
      };
    }
    case 'complete':
      return {
        step: 'complete',
        message: `Lesson complete.`,
        waitingForLearner: false,
      };
  }
}

function conceptTitle(
  concept: TutoringConcept,
  locale: LessonState['locale'],
): string {
  if (locale === 'sw' && concept.displayNameSw) {
    return concept.displayNameSw;
  }
  return concept.displayNameEn;
}

/** One-shot helper — starts a session and returns it ready for the UI. */
export async function startLesson(
  input: RunLessonInput,
  deps: LessonEngineDeps,
): Promise<LessonSession> {
  const concept = await deps.conceptStore.findBySlug({
    tenantId: input.tenantId,
    conceptSlug: input.conceptSlug,
  });
  if (!concept) {
    throw new TutoringEngineError(
      `Concept not found: ${input.conceptSlug}`,
      'CONCEPT_NOT_FOUND',
    );
  }
  const grounded = await groundWorkedExample({
    concept,
    tenantId: input.tenantId,
    dataAdapter: deps.dataAdapter,
  });
  const state = initialState(input);
  return new LessonSession({
    concept,
    groundedExample: grounded,
    state,
    deps,
  });
}

/**
 * Run the full lesson auto-mode (no learner replies). Useful for
 * tests, fall-back rendering when no UI is available, and the
 * "generate study notes" feature where we just want the text.
 */
export async function runLesson(
  input: RunLessonInput,
  deps: LessonEngineDeps,
): Promise<readonly LessonEvent[]> {
  const session = await startLesson(input, deps);
  const events: LessonEvent[] = [];
  // Auto-mode: walk through every non-interactive step and ANSWER
  // every check correctly so the lesson reaches `complete`.
  events.push(session.describeCurrent());

  while (session.state.step !== 'complete') {
    if (session.state.step === 'assess') {
      // Auto-fill the assess prompt with a placeholder reply.
      events.push(await session.submit('I have some idea.'));
      continue;
    }
    if (session.state.step === 'check_understanding') {
      const idx = session.state.checkIndex;
      const concept = await deps.conceptStore.findBySlug({
        tenantId: input.tenantId,
        conceptSlug: input.conceptSlug,
      });
      const probe = concept?.content.check_understanding[idx];
      // Synthesize a passing reply that matches the expected pattern.
      const probePattern = probe?.expected_pattern ?? '';
      const reply = synthesizePassingReply(probePattern);
      events.push(await session.submit(reply));
      continue;
    }
    events.push(await session.submit(null));
  }
  return events;
}

/**
 * Produce a literal string that the seed regex matches. Handles the
 * `a|b` alternation that's prevalent in the seeded patterns. Falls
 * back to the pattern itself otherwise.
 */
export function synthesizePassingReply(pattern: string): string {
  if (!pattern) return 'yes';
  // Strip word boundaries / numeric repetition modifiers.
  const cleaned = pattern.replace(/\\\\d|\\b|\\w|\\\?/g, '');
  // Take the first alternation branch (no parens, '|' top-level).
  if (cleaned.includes('|')) {
    const first = cleaned.split('|')[0] ?? '';
    return first.replace(/[\\^$.()+?\[\]{}]/g, '').trim() || 'yes';
  }
  return cleaned.replace(/[\\^$.()+?\[\]{}]/g, '').trim() || 'yes';
}
