/**
 * Deterministic course sequencer — the honest-degrade fallback.
 *
 * When no LLM is wired (tests, missing key, degraded mode) the course
 * generator MUST NOT fabricate a course. Instead it builds a real course from
 * the curated mining concept catalog (`ESTATE_CONCEPTS`): concept summaries
 * become lesson bodies, worked examples become grounded illustrations, and quiz
 * questions / distractors are drawn from sibling concepts in the same category.
 * Everything here is genuine catalog content — the only thing "synthetic" is the
 * arrangement, which is exactly what a sequencer is for.
 *
 * Pure + deterministic (modulo the seeded rotation): the same inputs always
 * produce the same course, which keeps it testable and reproducible.
 *
 * Reuses the concept-selection spirit from the scenario generator (score,
 * prerequisite ordering) but emits the strict `GeneratedCourse` quiz/lesson
 * shape this module defines.
 *
 * Ported from the BossNyumba deterministic course sequencer and retargeted
 * real-estate -> mining (via the mining concept catalog).
 *
 * @module courses/deterministic-sequencer
 */

import {
  ESTATE_CONCEPTS,
  type Concept,
  type WorkedExample,
} from '../training/concepts-catalog.js';
import { findCourseDomain } from './domains.js';
import {
  MIN_LESSONS,
  MAX_LESSONS,
  QUIZ_QUESTIONS_PER_LESSON,
  QUIZ_OPTIONS_PER_QUESTION,
  type CourseDifficulty,
  type CourseLanguage,
  type GeneratedCourse,
  type GeneratedLesson,
  type GeneratedQuizQuestion,
  type GenerateCourseInput,
} from './schema.js';

// ---------------------------------------------------------------------------
// Concept selection (topic + domain biased, prerequisite-ordered)
// ---------------------------------------------------------------------------

function tokenize(text: string): ReadonlyArray<string> {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2);
}

function scoreConcept(concept: Concept, needleTokens: ReadonlyArray<string>): number {
  const hay =
    `${concept.id} ${concept.titleEn} ${concept.summaryEn} ${concept.category}`.toLowerCase();
  return needleTokens.reduce((acc, t) => (hay.includes(t) ? acc + 1 : acc), 0);
}

function orderByPrerequisites(
  selected: ReadonlyArray<Concept>,
): ReadonlyArray<Concept> {
  const visited = new Set<string>();
  const ordered: Concept[] = [];
  const index = new Map(selected.map((c) => [c.id, c]));

  function visit(c: Concept): void {
    if (visited.has(c.id)) return;
    visited.add(c.id);
    for (const pid of c.prerequisites) {
      const p = index.get(pid);
      if (p) visit(p);
    }
    ordered.push(c);
  }

  for (const c of selected) visit(c);
  return ordered;
}

function difficultyCeiling(difficulty: CourseDifficulty): number {
  if (difficulty === 'beginner') return 2;
  if (difficulty === 'intermediate') return 3;
  return 5;
}

/**
 * Pick the lessons' concepts. Scores every concept against the scenario text +
 * domain seed, biases toward the domain's category and the chosen difficulty
 * band, then prerequisite-orders the winners. Falls back to the easiest
 * concepts in the domain's category so a course always has real content.
 */
export function selectConcepts(input: GenerateCourseInput): ReadonlyArray<Concept> {
  const domain = findCourseDomain(input.domain);
  const seed = `${input.scenarioDescription} ${domain?.topicSeed ?? input.domain}`;
  const tokens = tokenize(seed);
  const ceiling = difficultyCeiling(input.difficulty);

  const scored = ESTATE_CONCEPTS.map((c) => {
    let score = scoreConcept(c, tokens);
    if (domain && c.category === domain.conceptCategory) score += 2;
    // Keep the band sensible for the learner's stated comfort level.
    if (c.difficultyRank <= ceiling) score += 1;
    else score -= 1;
    return { c, score };
  })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.c.difficultyRank - b.c.difficultyRank);

  const target = Math.min(MAX_LESSONS, Math.max(MIN_LESSONS, scored.length));

  let chosen: ReadonlyArray<Concept> =
    scored.length >= MIN_LESSONS
      ? scored.slice(0, target).map((x) => x.c)
      : fallbackConcepts(domain?.conceptCategory ?? 'financial', target);

  // Guarantee the minimum even if scoring was sparse.
  if (chosen.length < MIN_LESSONS) {
    chosen = fallbackConcepts(domain?.conceptCategory ?? 'financial', MIN_LESSONS);
  }

  return orderByPrerequisites(chosen);
}

function fallbackConcepts(
  category: Concept['category'],
  count: number,
): ReadonlyArray<Concept> {
  const inCategory = ESTATE_CONCEPTS.filter((c) => c.category === category).sort(
    (a, b) => a.difficultyRank - b.difficultyRank,
  );
  const pool = inCategory.length >= count ? inCategory : [...ESTATE_CONCEPTS];
  return pool.slice(0, Math.max(MIN_LESSONS, count));
}

// ---------------------------------------------------------------------------
// Lesson + quiz construction from real catalog content
// ---------------------------------------------------------------------------

function lessonContent(concept: Concept, language: CourseLanguage): string {
  const useSw = language === 'sw';
  const title = useSw ? concept.titleSw : concept.titleEn;
  const summary = useSw ? concept.summarySw : concept.summaryEn;
  const examplesHeading = useSw ? 'Mifano halisi' : 'Worked examples';
  const lines: string[] = [`# ${title}`, '', summary, ''];
  if (concept.workedExamples.length > 0) {
    lines.push(`## ${examplesHeading}`, '');
    for (const ex of concept.workedExamples) {
      lines.push(`### ${ex.title} (${ex.market})`);
      lines.push(`- ${useSw ? 'Taarifa' : 'Inputs'}: ${ex.inputs}`);
      lines.push(`- ${useSw ? 'Hesabu' : 'Calculation'}: ${ex.calculation}`);
      lines.push(`- ${useSw ? 'Jibu' : 'Answer'}: ${ex.answer}`);
      lines.push('');
    }
  }
  return lines.join('\n').trim();
}

function objectivesFor(concept: Concept, language: CourseLanguage): string[] {
  const useSw = language === 'sw';
  const title = useSw ? concept.titleSw : concept.titleEn;
  if (useSw) {
    return [
      `Eleza ${title} kwa maneno yako.`,
      `Tambua wakati ${title} inatumika kazini.`,
    ];
  }
  return [
    `Explain ${title} in your own words.`,
    `Recognise when ${title} applies in day-to-day mine work.`,
  ];
}

function takeawaysFor(concept: Concept, language: CourseLanguage): string[] {
  const useSw = language === 'sw';
  const summary = useSw ? concept.summarySw : concept.summaryEn;
  const out = [summary];
  const firstExample = concept.workedExamples[0];
  if (firstExample) out.push(firstExample.answer);
  return out;
}

/**
 * Place `correct` at slot `shift` within `[correct, ...distractors]`, returning
 * exactly QUIZ_OPTIONS_PER_QUESTION options and the correct slot index. Avoids
 * the `slice(-0)` whole-array footgun by rotating with index arithmetic.
 */
function placeCorrect(
  correct: string,
  distractors: ReadonlyArray<string>,
  shift: number,
): { options: string[]; correctOptionIndex: number } {
  const n = QUIZ_OPTIONS_PER_QUESTION;
  const slot = ((shift % n) + n) % n;
  const options: string[] = [];
  let d = 0;
  for (let i = 0; i < n; i++) {
    if (i === slot) {
      options.push(correct);
    } else {
      options.push(distractors[d] ?? `Option ${i + 1}`);
      d += 1;
    }
  }
  return { options, correctOptionIndex: slot };
}

/**
 * Build a deterministic 4-option quiz question for a worked example. The stem
 * is the example's inputs; the correct option is the example's answer;
 * distractors are sibling examples' answers from the same category (real
 * content, plausibly wrong here). A seeded rotation spreads the correct slot
 * across A/B/C/D.
 */
function quizFromExample(
  example: WorkedExample,
  distractorPool: ReadonlyArray<string>,
  rotation: number,
  language: CourseLanguage,
): GeneratedQuizQuestion {
  const useSw = language === 'sw';
  const distractors = distractorPool
    .filter((d) => d !== example.answer)
    .slice(0, QUIZ_OPTIONS_PER_QUESTION - 1);

  // Pad with safe, clearly-wrong generic options if the pool is thin.
  while (distractors.length < QUIZ_OPTIONS_PER_QUESTION - 1) {
    distractors.push(
      useSw
        ? `Hakuna hatua inayohitajika (${distractors.length + 1})`
        : `No action is required (${distractors.length + 1})`,
    );
  }

  const { options, correctOptionIndex } = placeCorrect(
    example.answer,
    distractors,
    rotation,
  );

  const question = useSw
    ? `Kwa hali hii: ${example.inputs} Hatua sahihi ni ipi?`
    : `Given this case: ${example.inputs} What is the right call?`;
  const explanation = useSw
    ? `Hesabu: ${example.calculation} Kwa hiyo: ${example.answer}`
    : `Calculation: ${example.calculation} Therefore: ${example.answer}`;

  return {
    question,
    options,
    correctOptionIndex,
    explanation,
  };
}

/** A conceptual (non-numeric) recall question, used to top up to 5 per lesson. */
function recallQuestion(
  concept: Concept,
  siblings: ReadonlyArray<Concept>,
  rotation: number,
  language: CourseLanguage,
): GeneratedQuizQuestion {
  const useSw = language === 'sw';
  const correct = useSw ? concept.summarySw : concept.summaryEn;
  const distractors = siblings
    .filter((s) => s.id !== concept.id)
    .slice(0, QUIZ_OPTIONS_PER_QUESTION - 1)
    .map((s) => (useSw ? s.summarySw : s.summaryEn));
  while (distractors.length < QUIZ_OPTIONS_PER_QUESTION - 1) {
    distractors.push(
      useSw
        ? `Hili halihusiani na ${concept.titleSw}.`
        : `This is unrelated to ${concept.titleEn}.`,
    );
  }
  const { options, correctOptionIndex } = placeCorrect(
    correct,
    distractors,
    rotation,
  );
  const title = useSw ? concept.titleSw : concept.titleEn;
  return {
    question: useSw
      ? `Ni kauli ipi inayoeleza vyema ${title}?`
      : `Which statement best describes ${title}?`,
    options,
    correctOptionIndex,
    explanation: useSw
      ? `${title}: ${concept.summarySw}`
      : `${title}: ${concept.summaryEn}`,
  };
}

function buildQuiz(
  concept: Concept,
  category: ReadonlyArray<Concept>,
  language: CourseLanguage,
): ReadonlyArray<GeneratedQuizQuestion> {
  const siblingAnswers = category
    .flatMap((c) => c.workedExamples.map((e) => e.answer))
    .filter((a) => a.length > 0);

  const questions: GeneratedQuizQuestion[] = [];
  concept.workedExamples.forEach((ex, i) => {
    if (questions.length >= QUIZ_QUESTIONS_PER_LESSON) return;
    questions.push(quizFromExample(ex, siblingAnswers, i + 1, language));
  });

  // Top up to exactly QUIZ_QUESTIONS_PER_LESSON with recall questions.
  let r = questions.length;
  while (questions.length < QUIZ_QUESTIONS_PER_LESSON) {
    questions.push(recallQuestion(concept, category, r + 1, language));
    r += 1;
  }

  return questions.slice(0, QUIZ_QUESTIONS_PER_LESSON);
}

function buildLesson(
  concept: Concept,
  category: ReadonlyArray<Concept>,
  language: CourseLanguage,
): GeneratedLesson {
  return {
    title: language === 'sw' ? concept.titleSw : concept.titleEn,
    objectives: objectivesFor(concept, language),
    content: lessonContent(concept, language),
    keyTakeaways: takeawaysFor(concept, language),
    quiz: buildQuiz(concept, category, language),
    estimatedMinutes: 10 + concept.difficultyRank * 3,
  };
}

// ---------------------------------------------------------------------------
// Public: build a complete course deterministically
// ---------------------------------------------------------------------------

export function buildDeterministicCourse(
  input: GenerateCourseInput,
): GeneratedCourse {
  const concepts = selectConcepts(input);
  const byCategory = new Map<Concept['category'], Concept[]>();
  for (const c of ESTATE_CONCEPTS) {
    const list = byCategory.get(c.category) ?? [];
    list.push(c);
    byCategory.set(c.category, list);
  }

  const lessons = concepts.map((concept) =>
    buildLesson(concept, byCategory.get(concept.category) ?? [concept], input.language),
  );

  const domainLabel = input.domainLabel?.trim() || input.domain;
  const useSw = input.language === 'sw';
  const title = useSw
    ? `Kozi ya ${domainLabel}`
    : `${domainLabel} course`;
  const summary = useSw
    ? `Kozi ya vitendo kuhusu ${domainLabel}, imeundwa kutoka katalogi ya dhana za uendeshaji wa mgodi. Inashughulikia: ${concepts
        .map((c) => c.titleSw)
        .join(', ')}.`
    : `A practical course on ${domainLabel}, sequenced from the mining concept catalog. It covers: ${concepts
        .map((c) => c.titleEn)
        .join(', ')}.`;

  return {
    title,
    summary,
    difficulty: input.difficulty,
    lessons,
  };
}
