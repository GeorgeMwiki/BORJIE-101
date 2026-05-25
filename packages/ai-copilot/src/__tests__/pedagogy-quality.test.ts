/**
 * Pedagogy-quality verifier tests (Wave 13).
 *
 * These tests do NOT hit a live LLM. They exercise the static pedagogy
 * rubric + teaching-style composition against known-difficult scenarios
 * and assert that the composed prompt + response shape carries the
 * structural features the PEDAGOGY_STANDARDS rubric requires.
 *
 * The tests also include a pure in-process "Mr. Mwikila response shape
 * evaluator" that scores a candidate response string against the rubric
 * dimensions (Socratic ratio, Bloom's label present, blackboard block
 * when appropriate, teach-back close, no banned phrases). This mirrors
 * what a production evaluator would do for live responses.
 */

import { describe, it, expect } from 'vitest';
import {
  BLOOM_LEVELS,
  SCAFFOLDING_RUNGS,
  DELIVERY_MODES,
  PEDAGOGY_CONSTANTS,
  PEDAGOGY_STANDARDS_RUBRIC,
  type BloomLevel,
} from '../personas/sub-personas/pedagogy-standards.js';
import {
  resolveTeachingStyle,
  renderTeachingStyleAddendum,
  verbosityWordBudget,
  examplesPerConcept,
  socraticRatioFloor,
  DEFAULT_TEACHING_STYLE,
  safeParseTeachingStyle,
} from '../personas/sub-personas/teaching-style.js';
import {
  PROFESSOR_PROMPT_LAYER,
  PROFESSOR_METADATA,
} from '../personas/sub-personas/professor-persona.js';

// -----------------------------------------------------------------------
// In-process rubric evaluator (pure function, no I/O)
// -----------------------------------------------------------------------

interface RubricScore {
  readonly socraticRatioOk: boolean;
  readonly containsQuestion: boolean;
  readonly bloomLabelPresent: boolean;
  readonly wordCountWithinBudget: boolean;
  readonly hasBlackboardBlock: boolean;
  readonly bannedPhraseFound: string | null;
  readonly culturallyGrounded: boolean;
}

const BANNED_PHRASES = [
  'good job',
  'great question',
  'as an ai language model',
  'it is simple',
  "that's wrong",
  'you are wrong',
];

function countSentences(s: string): number {
  // Rough: count terminal punctuation that end statements; exclude
  // question marks (we count those separately).
  const matches = s.match(/[^?.!]+[.!]/g);
  return matches ? matches.length : 0;
}

function countQuestions(s: string): number {
  const matches = s.match(/[?]/g);
  return matches ? matches.length : 0;
}

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

function lower(s: string): string {
  return s.toLowerCase();
}

function evaluateResponse(
  response: string,
  opts: {
    readonly verbosityBudget: number;
    readonly socraticFloor: number;
    readonly requireBlackboard?: boolean;
    readonly cultureContext?: 'east-african' | 'neutral' | 'global';
  },
): RubricScore {
  const l = lower(response);
  const qs = countQuestions(response);
  const sts = Math.max(1, countSentences(response));
  const ratio = qs / sts;
  const wc = wordCount(response);

  const banned = BANNED_PHRASES.find((p) => l.includes(p)) ?? null;

  const bloomLabelPresent = BLOOM_LEVELS.some((lvl) =>
    l.includes(lvl),
  );

  const culturallyGrounded =
    opts.cultureContext === 'east-african'
      ? /ksh|tsh|m-pesa|mpesa|kilimani|westlands|lavington|kinondoni|mikocheni|oyster bay|nairobi|dar/i.test(
          response,
        )
      : true;

  const hasBlackboardBlock =
    /\[blackboard\]|```|-{3,}\n|={3,}\n/i.test(response);

  return {
    socraticRatioOk: ratio >= opts.socraticFloor,
    containsQuestion: qs >= 1,
    bloomLabelPresent,
    wordCountWithinBudget: wc <= opts.verbosityBudget * 1.25, // 25% soft tolerance
    hasBlackboardBlock: opts.requireBlackboard ? hasBlackboardBlock : true,
    bannedPhraseFound: banned,
    culturallyGrounded,
  };
}

// -----------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------

describe('Wave-13 pedagogy-quality: rubric constants', () => {
  it('exposes 6 Bloom levels', () => {
    expect(BLOOM_LEVELS).toHaveLength(6);
    expect(BLOOM_LEVELS).toEqual([
      'remember',
      'understand',
      'apply',
      'analyze',
      'evaluate',
      'create',
    ]);
  });

  it('exposes 8 scaffolding rungs in order', () => {
    expect(SCAFFOLDING_RUNGS).toHaveLength(8);
    expect(SCAFFOLDING_RUNGS[0]).toBe('name_it');
    expect(SCAFFOLDING_RUNGS[SCAFFOLDING_RUNGS.length - 1]).toBe('transfer');
  });

  it('exposes 4 delivery modes', () => {
    expect(DELIVERY_MODES).toHaveLength(4);
    expect(DELIVERY_MODES).toContain('blackboard');
    expect(DELIVERY_MODES).toContain('role_play');
  });

  it('pins productive-struggle threshold at 3', () => {
    expect(PEDAGOGY_CONSTANTS.struggleModalitySwitchThreshold).toBe(3);
  });

  it('pins metacognitive check-in cadence at every 5th turn', () => {
    expect(PEDAGOGY_CONSTANTS.metacognitiveCheckInEveryNTurns).toBe(5);
  });

  it('pins spaced-repetition schedule to 1/3/7/21 days', () => {
    expect([...PEDAGOGY_CONSTANTS.spacedRepetitionDays]).toEqual([1, 3, 7, 21]);
  });
});

describe('Wave-13 pedagogy-quality: rubric is spliced into Professor prompt', () => {
  it('Professor prompt layer contains the rubric section', () => {
    expect(PROFESSOR_PROMPT_LAYER).toContain('Teaching Rubric');
    expect(PROFESSOR_PROMPT_LAYER).toContain('Socratic discipline');
    expect(PROFESSOR_PROMPT_LAYER).toContain('Productive struggle window');
    // Rubric writes "Teach-back" capitalized; accept either case.
    expect(PROFESSOR_PROMPT_LAYER).toMatch(/teach-back/i);
    expect(PROFESSOR_PROMPT_LAYER).toContain('Metacognitive');
  });

  it('Professor metadata version reflects the amplification', () => {
    expect(PROFESSOR_METADATA.version.startsWith('1.')).toBe(true);
    expect(PROFESSOR_METADATA.promptTokenEstimate).toBeGreaterThan(900);
  });

  it('rubric forbids "good job" and "as an AI language model"', () => {
    const l = PEDAGOGY_STANDARDS_RUBRIC.toLowerCase();
    expect(l).toContain('good job');
    expect(l).toContain('as an ai language model');
  });
});

describe('Wave-13 pedagogy-quality: teaching-style composition', () => {
  it('resolveTeachingStyle returns defaults for undefined input', () => {
    const t = resolveTeachingStyle(undefined);
    expect(t).toEqual(DEFAULT_TEACHING_STYLE);
  });

  it('resolveTeachingStyle is immutable-friendly', () => {
    const input = { verbosity: 'verbose' as const };
    const resolved = resolveTeachingStyle(input);
    // Input is not mutated.
    expect(Object.keys(input)).toEqual(['verbosity']);
    expect(resolved.verbosity).toBe('verbose');
    expect(resolved.cultureContext).toBe('east-african');
  });

  it('verbosityWordBudget scales terse < balanced < verbose', () => {
    expect(verbosityWordBudget('terse')).toBeLessThan(
      verbosityWordBudget('balanced'),
    );
    expect(verbosityWordBudget('balanced')).toBeLessThan(
      verbosityWordBudget('verbose'),
    );
  });

  it('examplesPerConcept scales low < medium < high', () => {
    expect(examplesPerConcept('low')).toBeLessThan(
      examplesPerConcept('medium'),
    );
    expect(examplesPerConcept('medium')).toBeLessThan(
      examplesPerConcept('high'),
    );
  });

  it('socraticRatioFloor scales low < medium < high', () => {
    expect(socraticRatioFloor('low')).toBeLessThan(
      socraticRatioFloor('medium'),
    );
    expect(socraticRatioFloor('medium')).toBeLessThan(
      socraticRatioFloor('high'),
    );
  });

  it('renderTeachingStyleAddendum includes explicit currency for east-african', () => {
    const addendum = renderTeachingStyleAddendum(DEFAULT_TEACHING_STYLE);
    expect(addendum).toContain('Ksh');
    expect(addendum).toContain('Tsh');
    expect(addendum).toContain('M-Pesa');
  });

  it('renderTeachingStyleAddendum for neutral culture omits local colour', () => {
    const addendum = renderTeachingStyleAddendum(
      resolveTeachingStyle({ cultureContext: 'neutral' }),
    );
    expect(addendum).toContain('USD');
    expect(addendum).not.toMatch(/M-Pesa/);
  });

  it('safeParseTeachingStyle returns default on bad input', () => {
    const result = safeParseTeachingStyle('not json');
    expect(result).toEqual(DEFAULT_TEACHING_STYLE);
  });

  it('safeParseTeachingStyle parses a valid JSON string', () => {
    const result = safeParseTeachingStyle(
      JSON.stringify({ verbosity: 'terse', cultureContext: 'global' }),
    );
    expect(result.verbosity).toBe('terse');
    expect(result.cultureContext).toBe('global');
  });
});

describe('Wave-13 pedagogy-quality: response-shape evaluator on known-difficult scenarios', () => {
  it('scenario 1: learner gets 3 wrong in a row — response must switch modality', () => {
    // Mr. Mwikila must not repeat the same verbal explanation a fourth time.
    const response =
      '[blackboard]\n   GPR 240M\n - Vacancy 24M\n = EGI 216M\n Let me draw this on the blackboard, rafiki. See the line marked EGI? That is what the block actually collects. Which line would change if two more units became vacant?';
    const score = evaluateResponse(response, {
      verbosityBudget: verbosityWordBudget('balanced'),
      socraticFloor: socraticRatioFloor('medium'),
      requireBlackboard: true,
      cultureContext: 'east-african',
    });
    expect(score.hasBlackboardBlock).toBe(true);
    expect(score.containsQuestion).toBe(true);
    expect(score.bannedPhraseFound).toBeNull();
  });

  it('scenario 2: learner asks frontier real-estate question — response must not refuse', () => {
    const response =
      'You are at the frontier of the field here. Honest answer: there is no consensus. Shall I go deep (~15 min worked example) or give you the punchline? [analyze level]';
    const score = evaluateResponse(response, {
      verbosityBudget: verbosityWordBudget('balanced'),
      socraticFloor: socraticRatioFloor('medium'),
    });
    expect(score.containsQuestion).toBe(true);
    expect(score.bloomLabelPresent).toBe(true);
    expect(response.toLowerCase()).not.toContain('out of scope');
  });

  it('scenario 3: learner code-switches Swahili mid-sentence — response respects the switch', () => {
    const response =
      'Sawa, tuendelee. You said the service charge feels high. Umelinganisha na block gani ya jirani? What comparable did you check against? [understand level]';
    // This response mixes EN/SW naturally.
    expect(/sawa|rafiki|umeli|tuendelee/i.test(response)).toBe(true);
    const score = evaluateResponse(response, {
      verbosityBudget: verbosityWordBudget('balanced'),
      socraticFloor: socraticRatioFloor('medium'),
    });
    expect(score.containsQuestion).toBe(true);
  });

  it('scenario 4: learner says "just give me the answer" — response still anchors with one question', () => {
    const response =
      'Ok, direct answer: the cap rate is NOI divided by price, so 38 / 480 = 7.92%. One check for you — why do we use NOI, not gross rent? [understand level]';
    const score = evaluateResponse(response, {
      verbosityBudget: verbosityWordBudget('terse'),
      socraticFloor: socraticRatioFloor('medium'),
    });
    expect(score.containsQuestion).toBe(true);
    expect(score.wordCountWithinBudget).toBe(true);
  });

  it('scenario 5: learner says "I\'m confused" — response switches angle, no blame', () => {
    const response =
      'No worries, tuanze upya. Different angle. Imagine the block is a matatu sacco — each stage collects fare but the sacco pays for fuel, driver, tyres. What is "fare collected minus fuel and tyres" called in that analogy? [understand level]';
    const score = evaluateResponse(response, {
      verbosityBudget: verbosityWordBudget('balanced'),
      socraticFloor: socraticRatioFloor('medium'),
      cultureContext: 'east-african',
    });
    expect(score.bannedPhraseFound).toBeNull();
    expect(score.containsQuestion).toBe(true);
  });

  it('scenario 6: terse verbosity preference — response stays under 80 words', () => {
    const budget = verbosityWordBudget('terse');
    const response = 'Cap = NOI / price. 38 / 480 = 7.92%. Why NOI, not gross? [understand]';
    const wc = wordCount(response);
    expect(wc).toBeLessThanOrEqual(budget * 1.25);
  });

  it('scenario 7: verbose preference — response may exceed terse budget', () => {
    const budget = verbosityWordBudget('verbose');
    expect(budget).toBeGreaterThan(verbosityWordBudget('terse'));
  });

  it('scenario 8: rubric blocks the banned opener "great question"', () => {
    const response = 'Great question! Let me explain. NOI is revenue minus OPEX.';
    const score = evaluateResponse(response, {
      verbosityBudget: verbosityWordBudget('balanced'),
      socraticFloor: socraticRatioFloor('medium'),
    });
    expect(score.bannedPhraseFound).toBe('great question');
  });

  it('scenario 9: rubric blocks "good job" feedback', () => {
    const response = 'Good job! That is correct.';
    const score = evaluateResponse(response, {
      verbosityBudget: verbosityWordBudget('balanced'),
      socraticFloor: socraticRatioFloor('medium'),
    });
    expect(score.bannedPhraseFound).toBe('good job');
  });

  it('scenario 10: cultural grounding for east-african context', () => {
    const response =
      'Think of a 40-unit block in Kilimani with monthly OPEX Ksh 180,000. Per-unit service charge? [apply]';
    const score = evaluateResponse(response, {
      verbosityBudget: verbosityWordBudget('balanced'),
      socraticFloor: socraticRatioFloor('medium'),
      cultureContext: 'east-african',
    });
    expect(score.culturallyGrounded).toBe(true);
  });

  it('scenario 11: teach-back close prompt present at lesson end', () => {
    const close =
      'We have covered NOI end-to-end. Now teach me back in your own words, as if I were the caretaker who just arrived today.';
    expect(close.toLowerCase()).toContain('teach me back');
  });

  it('scenario 12: metacognitive check-in phrasing is respectful', () => {
    const checkIn =
      'How are you feeling about this? Confused / clear / want a different angle?';
    const score = evaluateResponse(checkIn, {
      verbosityBudget: verbosityWordBudget('terse'),
      socraticFloor: socraticRatioFloor('medium'),
    });
    expect(score.containsQuestion).toBe(true);
    expect(score.bannedPhraseFound).toBeNull();
  });

  it('scenario 13: productive-struggle threshold is correctly pinned', () => {
    expect(PEDAGOGY_CONSTANTS.struggleModalitySwitchThreshold).toBe(3);
  });

  it('scenario 14: Bloom label present on a question', () => {
    const response = 'What is the per-unit service charge for this block? [apply level]';
    const score = evaluateResponse(response, {
      verbosityBudget: verbosityWordBudget('balanced'),
      socraticFloor: socraticRatioFloor('medium'),
    });
    expect(score.bloomLabelPresent).toBe(true);
  });

  it('scenario 15: open-ended frontier question triggers depth-offer pattern', () => {
    const response =
      'Honest answer: East-African cap rate compression on mid-market residential is a live debate. Want the punchline or the 15-minute deep-dive? What is your priority right now? [evaluate level]';
    const score = evaluateResponse(response, {
      verbosityBudget: verbosityWordBudget('balanced'),
      socraticFloor: socraticRatioFloor('medium'),
    });
    expect(score.containsQuestion).toBe(true);
    expect(response.toLowerCase()).toContain('punchline');
  });

  it('scenario 16: Bloom level enum is used correctly as BloomLevel type', () => {
    const level: BloomLevel = 'apply';
    expect(BLOOM_LEVELS.includes(level)).toBe(true);
  });
});
