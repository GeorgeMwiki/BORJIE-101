import { describe, expect, it } from 'vitest';
import {
  decideScope,
  MAX_QUESTIONS_PER_TURN,
} from '../scoping/interactive-scoper.js';
import {
  buildQuestion,
  InvalidQuestionError,
  MAX_WORDS_PER_QUESTION,
} from '../scoping/question-generator.js';

describe('decideScope', () => {
  it('routes needs_clarification to ask with template questions', () => {
    const r = decideScope({
      sufficiency: {
        sufficiency: 'needs_clarification',
        missing_kinds: [],
        rationale: 'low confidence',
      },
      intent: 'compose_doc',
      is_new_user: true,
      questions_asked_this_turn: 0,
      template_questions: [
        { question: 'Which site?', why_needed: 'scope numbers to one site' },
      ],
    });
    expect(r.path).toBe('ask');
    expect(r.questions.length).toBe(1);
  });

  it('routes needs_data to request_data with at least one DataRequest', () => {
    const r = decideScope({
      sufficiency: {
        sufficiency: 'needs_data',
        missing_kinds: ['ingest'],
        rationale: 'missing ingest',
        preferred_data_kind: 'excel',
      },
      intent: 'compose_doc',
      is_new_user: false,
      questions_asked_this_turn: 0,
    });
    expect(r.path).toBe('request_data');
    expect(r.requested_data.length).toBe(1);
    expect(r.requested_data[0]?.kind).toBe('excel');
  });

  it('commits at MAX_QUESTIONS_PER_TURN with assumption block', () => {
    const r = decideScope({
      sufficiency: {
        sufficiency: 'needs_clarification',
        missing_kinds: [],
        rationale: 'still ambiguous',
      },
      intent: 'compose_doc',
      is_new_user: true,
      questions_asked_this_turn: MAX_QUESTIONS_PER_TURN,
    });
    expect(r.path).toBe('commit_best_guess');
    expect(r.best_guess_assumptions?.length).toBeGreaterThan(0);
  });

  it('caps total questions to MAX_QUESTIONS_PER_TURN minus already-asked', () => {
    const r = decideScope({
      sufficiency: {
        sufficiency: 'needs_clarification',
        missing_kinds: [],
        rationale: '',
      },
      intent: 'compose_doc',
      is_new_user: true,
      questions_asked_this_turn: 1,
      template_questions: [
        { question: 'Which site?', why_needed: 'scope' },
        { question: 'What time window?', why_needed: 'scope time' },
        { question: 'Who is the audience?', why_needed: 'scope audience' },
        { question: 'Format?', why_needed: 'scope format' },
      ],
    });
    expect(r.questions.length).toBeLessThanOrEqual(
      MAX_QUESTIONS_PER_TURN - 1,
    );
  });
});

describe('buildQuestion', () => {
  it('builds a clean question', () => {
    const q = buildQuestion({
      question: 'Which site is this for?',
      why_needed: 'narrows the dataset',
    });
    expect(q.question).toBe('Which site is this for?');
  });

  it('throws on compound questions (and-joined)', () => {
    expect(() =>
      buildQuestion({
        question: 'Which site and what time window?',
        why_needed: 'we ask both at once',
      }),
    ).toThrow(InvalidQuestionError);
  });

  it('throws on over-long questions', () => {
    const long = `${'word '.repeat(MAX_WORDS_PER_QUESTION + 5)}?`;
    expect(() =>
      buildQuestion({ question: long, why_needed: 'too long' }),
    ).toThrow(InvalidQuestionError);
  });
});
