/**
 * Socratic state machine for a single concept lesson.
 *
 * Steps (linear unless adapted):
 *   assess              — quick gauge of prior knowledge
 *   hook                — narrative motivation
 *   explain             — definition + formula
 *   worked_example      — with live tenant numbers + citations
 *   check_understanding — N probes; track correct / incorrect
 *   remediate           — branch on incorrect / "I don't get it"
 *   mastery             — record outcome
 *   complete            — terminal
 *
 * Branching rules (the "secret sauce"):
 *   - On a wrong answer to a `check_understanding`: emit the hint,
 *     remain on the same check.
 *   - On "I don't get it" (matched by simple keyword regex): branch
 *     to a sub-explanation tied to the worked example's citation
 *     placeholders. The learner's question text is used to choose
 *     which placeholder to expand.
 *   - On a second wrong answer to the same check: surface the
 *     common-mistakes list, then advance.
 */

import type {
  LessonState,
  TutoringConcept,
  TutoringCheckUnderstanding,
} from './types.js';

/** Build the initial lesson state. */
export function initialState(input: {
  readonly tenantId: string;
  readonly userId: string;
  readonly conceptSlug: string;
  readonly locale?: 'en' | 'sw';
}): LessonState {
  return {
    tenantId: input.tenantId,
    userId: input.userId,
    conceptSlug: input.conceptSlug,
    locale: input.locale ?? 'en',
    step: 'assess',
    checkIndex: 0,
    attempts: 0,
    correctCount: 0,
    incorrectCount: 0,
    citations: [],
  };
}

/** Step → next-step transition. The state machine is largely linear. */
export function nextStep(step: LessonState['step']): LessonState['step'] {
  switch (step) {
    case 'assess':
      return 'hook';
    case 'hook':
      return 'explain';
    case 'explain':
      return 'worked_example';
    case 'worked_example':
      return 'check_understanding';
    case 'check_understanding':
      return 'mastery';
    case 'remediate':
      return 'check_understanding';
    case 'mastery':
      return 'complete';
    case 'complete':
      return 'complete';
    default:
      return 'complete';
  }
}

/**
 * Did the learner say "I don't get it" or similar? We use this regex
 * rather than full NLU because tutor messages are short and a few
 * canonical phrases cover the vast majority.
 */
const I_DONT_GET_IT_RE =
  /\b(?:i\s+do(?:n['']|n)?t\s+(?:get|understand)|huelewi|sielewi|confused|lost|what\?)\b/i;

export function isDontGetIt(reply: string): boolean {
  return I_DONT_GET_IT_RE.test(reply.trim());
}

/**
 * Score one learner reply against the current check_understanding
 * probe. The expected_pattern is matched case-insensitively.
 */
export function scoreCheckAnswer(
  reply: string,
  check: TutoringCheckUnderstanding,
): 'correct' | 'incorrect' {
  let re: RegExp;
  try {
    re = new RegExp(check.expected_pattern, 'i');
  } catch {
    // Pattern is malformed in the seed; degrade to a substring match.
    return reply
      .trim()
      .toLowerCase()
      .includes(check.expected_pattern.toLowerCase())
      ? 'correct'
      : 'incorrect';
  }
  return re.test(reply.trim()) ? 'correct' : 'incorrect';
}

/**
 * Map a learner's "I don't get it" follow-up to a specific
 * citation placeholder. The keyword scan is deliberately simple —
 * grouped by category (income / expense / depreciation / etc.).
 */
export function pickCitationFocus(
  reply: string,
  concept: TutoringConcept,
): string | null {
  const lower = reply.toLowerCase();
  const placeholders = Object.keys(
    concept.dataBinding?.placeholders ?? {},
  );
  // Direct mention of a placeholder key beats everything.
  for (const key of placeholders) {
    if (lower.includes(key.toLowerCase().replace(/_/g, ' '))) return key;
  }
  // Heuristic mapping of common terms to placeholders.
  const TERM_MAP: ReadonlyArray<[RegExp, string]> = [
    [/gross|income|revenue/i, 'gross_income'],
    [/op[_\s-]?ex|operating|cost|expense/i, 'op_ex'],
    [/noi|net.{0,10}operating/i, 'noi'],
    [/cap.{0,4}rate/i, 'cap_rate'],
    [/value|price|market/i, 'value'],
    [/occupanc|occupied/i, 'occupied_units'],
    [/total.{0,3}units?/i, 'total_units'],
    [/bucket|aging|90|60|30/i, 'b1'],
    [/debit|credit/i, 'debits'],
    [/asset|liabilit|equity/i, 'assets'],
    [/cash[_\s-]?flow|operating[_\s-]?cash/i, 'cfo'],
  ];
  for (const [pattern, key] of TERM_MAP) {
    if (pattern.test(lower) && placeholders.includes(key)) {
      return key;
    }
  }
  return placeholders[0] ?? null;
}

/**
 * Pure function — given current state + reply, advance the lesson.
 * The orchestrator threads this through the lesson event stream.
 *
 * Returns the new state. State remains immutable; we return a new
 * object every time.
 */
export function advance(
  state: LessonState,
  reply: string | null,
  concept: TutoringConcept,
): LessonState {
  if (state.step === 'complete') return state;

  // Steps that don't consume a reply just advance.
  if (state.step === 'assess' || state.step === 'hook' || state.step === 'explain' || state.step === 'worked_example') {
    return { ...state, step: nextStep(state.step), attempts: 0 };
  }

  if (state.step === 'check_understanding') {
    const checks = concept.content.check_understanding;
    const current = checks[state.checkIndex];
    if (!current || reply == null) {
      // Out of checks → mastery.
      return { ...state, step: 'mastery', checkIndex: 0 };
    }
    if (isDontGetIt(reply)) {
      return {
        ...state,
        step: 'remediate',
        attempts: state.attempts + 1,
      };
    }
    const score = scoreCheckAnswer(reply, current);
    if (score === 'correct') {
      const nextIndex = state.checkIndex + 1;
      const done = nextIndex >= checks.length;
      return {
        ...state,
        step: done ? 'mastery' : 'check_understanding',
        checkIndex: done ? 0 : nextIndex,
        attempts: 0,
        correctCount: state.correctCount + 1,
      };
    }
    // Incorrect — first attempt stays on the same probe; second
    // attempt advances after surfacing common mistakes.
    if (state.attempts === 0) {
      return {
        ...state,
        attempts: 1,
        incorrectCount: state.incorrectCount + 1,
      };
    }
    const nextIndex = state.checkIndex + 1;
    const done = nextIndex >= checks.length;
    return {
      ...state,
      step: done ? 'mastery' : 'check_understanding',
      checkIndex: done ? 0 : nextIndex,
      attempts: 0,
      incorrectCount: state.incorrectCount + 1,
    };
  }

  if (state.step === 'remediate') {
    // After remediation we go back to the same check_understanding probe.
    return { ...state, step: 'check_understanding', attempts: 0 };
  }

  if (state.step === 'mastery') {
    return { ...state, step: 'complete' };
  }

  return state;
}
