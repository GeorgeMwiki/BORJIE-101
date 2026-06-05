/**
 * Course generator — public API.
 *
 * Generates AI mining-estate courses for the owner-cockpit create-course flow
 * (domain + scenario + optional documents -> a strict, validated course of 5 to
 * 8 lessons). Honest-degrade: an LLM produces the course when wired, otherwise
 * the deterministic sequencer builds a real course from the mining concept
 * catalog (`ESTATE_CONCEPTS`).
 *
 * `CourseGenerator` / `getCourseGenerator` may be handed an `LLMLike` that
 * pulls the model layer; the generator itself has no model import. The schema +
 * domains modules are isomorphic and safe to import through the
 * `@borjie/ai-copilot/courses` subpath export (this avoids pulling package
 * internals into a type-only consumer).
 *
 * @module courses
 */

export {
  CourseGenerator,
  getCourseGenerator,
  type LLMLike,
  type CourseGeneratorDeps,
  type GenerateCourseResult,
} from './course-generator.js';

export {
  buildDeterministicCourse,
  selectConcepts,
} from './deterministic-sequencer.js';

export { buildSystemPrompt, buildUserPrompt } from './prompt-templates.js';

export {
  COURSE_DOMAINS,
  findCourseDomain,
  courseDomainLabel,
  type CourseDomain,
} from './domains.js';

export {
  GeneratedQuizQuestionSchema,
  GeneratedLessonSchema,
  GeneratedCourseSchema,
  GenerateCourseInputSchema,
  MIN_LESSONS,
  MAX_LESSONS,
  QUIZ_QUESTIONS_PER_LESSON,
  QUIZ_OPTIONS_PER_QUESTION,
  COURSE_LANGUAGES,
  COURSE_DIFFICULTIES,
  type GeneratedQuizQuestion,
  type GeneratedLesson,
  type GeneratedCourse,
  type GenerateCourseInput,
  type CourseDocumentContext,
  type CourseLanguage,
  type CourseDifficulty,
  type CourseStatus,
  type CourseGenerationSource,
  type CourseLessonRow,
  type CourseSummary,
  type CourseWithLessons,
} from './schema.js';
