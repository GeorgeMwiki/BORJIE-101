/**
 * Question generator — Discipline 4, stage 1.
 *
 * Produces minimally-invasive clarifying questions. Enforces a 25-word
 * cap per question (spec §6). Rejects questions that ask >1 thing
 * (compound with "and" + "?").
 *
 * @module @borjie/cognitive-engine/scoping/question-generator
 */

import type { ClarifyingQuestion } from '../types.js';

export const MAX_WORDS_PER_QUESTION = 25;

export class InvalidQuestionError extends Error {
  public override readonly name = 'InvalidQuestionError';
}

/** Build a question if it passes the lint; otherwise throw. */
export function buildQuestion(input: {
  readonly question: string;
  readonly why_needed: string;
  readonly possible_answers?: ReadonlyArray<string>;
}): ClarifyingQuestion {
  const wc = wordCount(input.question);
  if (wc > MAX_WORDS_PER_QUESTION) {
    throw new InvalidQuestionError(
      `question exceeds ${MAX_WORDS_PER_QUESTION}-word cap: ${wc} words`,
    );
  }
  if (isCompound(input.question)) {
    throw new InvalidQuestionError(
      'question asks more than one thing — split it into separate questions',
    );
  }
  const base = {
    question: input.question.trim(),
    why_needed: input.why_needed.trim(),
  } as const;
  return input.possible_answers === undefined
    ? base
    : { ...base, possible_answers: input.possible_answers };
}

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter((t) => t.length > 0).length;
}

/** Compound = contains " and " AND ends with a question mark. */
function isCompound(s: string): boolean {
  const lower = s.toLowerCase();
  return lower.includes(' and ') && s.trim().endsWith('?');
}

/** Default scoping questions surfaced when the engine has no
 *  capability-specific template. */
export const DEFAULT_NEW_USER_QUESTIONS: ReadonlyArray<ClarifyingQuestion> = [
  {
    question: 'Which site or operation is this for?',
    why_needed: 'I scope all numbers to one site to keep the output focused.',
  },
  {
    question: 'What time window — last quarter or year-to-date?',
    why_needed: 'Time window changes which records I pull.',
  },
  {
    question: 'Who is the audience — owner, regulator, or buyer?',
    why_needed: 'Audience changes tone, depth, and which figures lead.',
  },
];
