/**
 * Course generator — runtime zod schemas + explicit TS shapes.
 *
 * Single source of truth for an AI-generated MINING-estate course. The
 * generator validates raw model JSON against `GeneratedCourseSchema`; the route
 * persists + returns the validated object; the owner-web FE renders it.
 *
 * Ported from the BossNyumba course generator and retargeted real-estate ->
 * mining (mine operations, licensing/compliance, royalties/finance, safety,
 * offtake/commercial). Bilingual EN/SW, single-language per course (never
 * mixed — CLAUDE.md absolute-locale rule).
 *
 * TWO REPO PITFALLS AVOIDED HERE:
 *   - z.infer object-widening (TS6.0.3 + zod 3.25): object types are declared
 *     as explicit `interface`s, NEVER derived via `z.infer<typeof schema>`
 *     (which widens required keys to optional -> TS2345). The zod schemas are
 *     kept ONLY for runtime `safeParse`.
 *   - This module is isomorphic (types erase, zod is isomorphic) so it is safe
 *     to import from both the server generator and — via the dedicated
 *     `@borjie/ai-copilot/courses` subpath export — anywhere a type is needed.
 *     The LLM-bearing generator lives in a sibling file.
 *
 * @module courses/schema
 */

import { z } from 'zod';

// ============================================================================
// Bounds the prompt promises and we enforce
// ============================================================================

export const MIN_LESSONS = 5;
export const MAX_LESSONS = 8;
export const QUIZ_QUESTIONS_PER_LESSON = 5;
export const QUIZ_OPTIONS_PER_QUESTION = 4;

export const COURSE_LANGUAGES = ['en', 'sw'] as const;
export const COURSE_DIFFICULTIES = [
  'beginner',
  'intermediate',
  'advanced',
] as const;

export type CourseLanguage = (typeof COURSE_LANGUAGES)[number];
export type CourseDifficulty = (typeof COURSE_DIFFICULTIES)[number];

export type CourseStatus = 'draft' | 'in_progress' | 'completed';

// ============================================================================
// Quiz question
// ============================================================================

/**
 * A single multiple-choice quiz question. `correctOptionIndex` is the 0-based
 * index into `options` (one fewer invariant for the model to break than an
 * embedded id). Explicit interface — NOT `z.infer`.
 */
export interface GeneratedQuizQuestion {
  readonly question: string;
  readonly options: ReadonlyArray<string>;
  readonly correctOptionIndex: number;
  readonly explanation: string;
}

export const GeneratedQuizQuestionSchema = z
  .object({
    question: z.string().min(1).max(600),
    options: z
      .array(z.string().min(1).max(400))
      .length(QUIZ_OPTIONS_PER_QUESTION),
    correctOptionIndex: z
      .number()
      .int()
      .min(0)
      .max(QUIZ_OPTIONS_PER_QUESTION - 1),
    explanation: z.string().min(1).max(800),
  })
  .strict();

// ============================================================================
// Lesson
// ============================================================================

export interface GeneratedLesson {
  readonly title: string;
  readonly objectives: ReadonlyArray<string>;
  /** Markdown lesson body. */
  readonly content: string;
  readonly keyTakeaways: ReadonlyArray<string>;
  readonly quiz: ReadonlyArray<GeneratedQuizQuestion>;
  readonly estimatedMinutes: number;
}

export const GeneratedLessonSchema = z
  .object({
    title: z.string().min(1).max(200),
    objectives: z.array(z.string().min(1).max(300)).min(1).max(6),
    content: z.string().min(1).max(20_000),
    keyTakeaways: z.array(z.string().min(1).max(400)).min(1).max(8),
    quiz: z.array(GeneratedQuizQuestionSchema).length(QUIZ_QUESTIONS_PER_LESSON),
    estimatedMinutes: z.number().int().min(1).max(120),
  })
  .strict();

// ============================================================================
// Course (the strict JSON the model must emit)
// ============================================================================

export interface GeneratedCourse {
  readonly title: string;
  readonly summary: string;
  readonly difficulty: CourseDifficulty;
  readonly lessons: ReadonlyArray<GeneratedLesson>;
}

export const GeneratedCourseSchema = z
  .object({
    title: z.string().min(1).max(200),
    summary: z.string().min(1).max(1_500),
    difficulty: z.enum(COURSE_DIFFICULTIES),
    lessons: z.array(GeneratedLessonSchema).min(MIN_LESSONS).max(MAX_LESSONS),
  })
  .strict();

// ============================================================================
// Generator input
// ============================================================================

export interface CourseDocumentContext {
  readonly documentName: string;
  readonly documentType: string;
  readonly summary: string;
}

export interface GenerateCourseInput {
  /** Selected mining-topic domain id (see COURSE_DOMAINS). */
  readonly domain: string;
  /** Human-readable domain label resolved by the caller for the prompt. */
  readonly domainLabel?: string;
  readonly scenarioDescription: string;
  readonly documentContext?: ReadonlyArray<CourseDocumentContext>;
  readonly language: CourseLanguage;
  readonly difficulty: CourseDifficulty;
}

export const GenerateCourseInputSchema = z
  .object({
    domain: z.string().min(1).max(200),
    domainLabel: z.string().min(1).max(200).optional(),
    scenarioDescription: z.string().min(10).max(4_000),
    documentContext: z
      .array(
        z.object({
          documentName: z.string().max(300),
          documentType: z.string().max(200),
          summary: z.string().max(4_000),
        }),
      )
      .max(10)
      .optional(),
    language: z.enum(COURSE_LANGUAGES),
    difficulty: z.enum(COURSE_DIFFICULTIES),
  })
  .strict();

// ============================================================================
// Persisted shapes returned by the API (course + lessons)
// ============================================================================

export interface CourseLessonRow {
  readonly id: string;
  readonly lessonNumber: number;
  readonly lessonTitle: string;
  readonly status: 'not_started' | 'in_progress' | 'completed';
  readonly quizScore: number | null;
  readonly content: GeneratedLesson;
}

export interface CourseSummary {
  readonly id: string;
  readonly domain: string;
  readonly scenarioDescription: string;
  readonly status: CourseStatus;
  readonly difficulty: CourseDifficulty;
  readonly language: CourseLanguage;
  readonly title: string;
  readonly summary: string;
  readonly lessonCount: number;
  readonly generatedVia: CourseGenerationSource;
  readonly createdAt: string;
  readonly updatedAt: string;
  /**
   * Background-generation outcome marker. The kickoff returns a `draft`
   * placeholder (lessonCount 0) immediately, then finalises in the
   * background. A failure stays `draft` and stores its message here so the
   * poller can show a retry affordance. Absent on healthy courses.
   */
  readonly generationError?: string;
}

export interface CourseWithLessons extends CourseSummary {
  readonly lessons: ReadonlyArray<CourseLessonRow>;
}

/**
 * Honest-degrade provenance. `llm` = produced by the brain/LLM router;
 * `deterministic` = produced by the concept-catalog sequencer fallback (no
 * LLM available). Persisted so the UI can be transparent about how a course
 * was built — we NEVER silently fabricate.
 */
export type CourseGenerationSource = 'llm' | 'deterministic';
