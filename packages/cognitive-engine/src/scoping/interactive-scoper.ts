/**
 * Interactive scoper — Discipline 4 orchestrator.
 *
 * Decides whether to ask questions, request data, or commit to a
 * best-guess interpretation. Enforces the hard cap of 3 clarifying
 * questions per turn (spec §6).
 *
 * @module @borjie/cognitive-engine/scoping/interactive-scoper
 */

import type {
  ClarifyingQuestion,
  DataRequest,
  EvidenceItem,
  IngestKind,
} from '../types.js';
import type { SufficiencyDecision } from '../reasoning/sufficiency-check.js';
import {
  buildQuestion,
  DEFAULT_NEW_USER_QUESTIONS,
  InvalidQuestionError,
} from './question-generator.js';
import { buildDataRequest } from './data-request-builder.js';

export const MAX_QUESTIONS_PER_TURN = 3;

export interface ScoperInput {
  readonly sufficiency: SufficiencyDecision;
  readonly intent: string;
  readonly is_new_user: boolean;
  readonly questions_asked_this_turn: number;
  /** Optional template questions specific to this intent. */
  readonly template_questions?: ReadonlyArray<{
    readonly question: string;
    readonly why_needed: string;
    readonly possible_answers?: ReadonlyArray<string>;
  }>;
}

export type ScoperPath = 'ask' | 'request_data' | 'commit_best_guess';

export interface ScoperResult {
  readonly path: ScoperPath;
  readonly questions: ReadonlyArray<ClarifyingQuestion>;
  readonly requested_data: ReadonlyArray<DataRequest>;
  readonly best_guess_assumptions?: ReadonlyArray<string>;
}

export function decideScope(input: ScoperInput): ScoperResult {
  // Hard cap reached → commit with assumptions.
  if (input.questions_asked_this_turn >= MAX_QUESTIONS_PER_TURN) {
    return {
      path: 'commit_best_guess',
      questions: [],
      requested_data: [],
      best_guess_assumptions: [
        'No further clarification — proceeding with current best interpretation.',
      ],
    };
  }

  switch (input.sufficiency.sufficiency) {
    case 'needs_clarification': {
      const questions = pickQuestions(input);
      return {
        path: 'ask',
        questions,
        requested_data: [],
      };
    }
    case 'needs_data': {
      const requested = input.sufficiency.missing_kinds.map((k) =>
        buildDataRequest({
          missing_kind: k,
          intent: input.intent,
          ...(input.sufficiency.preferred_data_kind !== undefined
            ? { preferred_data_kind: input.sufficiency.preferred_data_kind }
            : {}),
        } satisfies {
          readonly missing_kind: EvidenceItem['kind'];
          readonly intent: string;
          readonly preferred_data_kind?: IngestKind;
        }),
      );
      return {
        path: 'request_data',
        questions: [],
        requested_data: requested,
      };
    }
    case 'sufficient':
    case 'needs_research':
    default:
      return {
        path: 'commit_best_guess',
        questions: [],
        requested_data: [],
      };
  }
}

function pickQuestions(input: ScoperInput): ReadonlyArray<ClarifyingQuestion> {
  const remaining = MAX_QUESTIONS_PER_TURN - input.questions_asked_this_turn;
  const templates = input.template_questions ?? [];

  const built: Array<ClarifyingQuestion> = [];
  for (const t of templates.slice(0, remaining)) {
    try {
      built.push(buildQuestion(t));
    } catch (err) {
      if (err instanceof InvalidQuestionError) continue;
      throw err;
    }
  }
  if (built.length === 0 && input.is_new_user) {
    return DEFAULT_NEW_USER_QUESTIONS.slice(0, remaining);
  }
  return built;
}
