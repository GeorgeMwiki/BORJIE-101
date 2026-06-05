/**
 * Courses TYPE shapes — the pure-type contract for /api/v1/courses/*.
 *
 * This module holds ONLY type/interface declarations with ZERO runtime or client
 * imports. It is the resolution target for the `@borjie/api-client/courses-types`
 * tsconfig path alias used by the owner-web cockpit (which fetches natively via
 * its own gateway client and imports only TYPE shapes). Keeping the types here —
 * rather than in `courses.ts` — prevents a NodeNext type-only consumer from
 * pulling the service's `../client` (and its transitive
 * `exactOptionalPropertyTypes` surface) into a strict app typecheck.
 *
 * The runtime service in `courses.ts` re-exports every type from here, so the
 * typed contract stays single-sourced.
 *
 * Object shapes are explicit interfaces (NOT z.infer) so a strict consumer with
 * exactOptionalPropertyTypes never sees a widened/optional-key drift.
 *
 * Ported from the BossNyumba courses service types and retargeted real-estate
 * -> mining.
 */

export type CourseLanguage = 'en' | 'sw';
export type CourseDifficulty = 'beginner' | 'intermediate' | 'advanced';
export type CourseStatus = 'draft' | 'in_progress' | 'completed';
export type CourseLessonStatus = 'not_started' | 'in_progress' | 'completed';
export type CourseGenerationSource = 'llm' | 'deterministic';

export interface CourseQuizQuestion {
  readonly question: string;
  readonly options: readonly string[];
  readonly correctOptionIndex: number;
  readonly explanation: string;
}

export interface CourseLessonContent {
  readonly title: string;
  readonly objectives: readonly string[];
  readonly content: string;
  readonly keyTakeaways: readonly string[];
  readonly quiz: readonly CourseQuizQuestion[];
  readonly estimatedMinutes: number;
}

export interface CourseLessonRow {
  readonly id: string;
  readonly lessonNumber: number;
  readonly lessonTitle: string;
  readonly status: CourseLessonStatus;
  readonly quizScore: number | null;
  readonly content: CourseLessonContent;
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
  /** Present only when a background generation failed (status stays 'draft'). */
  readonly generationError?: string;
}

export interface CourseWithLessons extends CourseSummary {
  readonly lessons: readonly CourseLessonRow[];
}

export interface CourseDocumentInput {
  readonly documentId: string;
  readonly documentName?: string;
  readonly documentType?: string;
  readonly summary?: string;
  readonly extractedData?: Record<string, unknown>;
}

export interface GenerateCourseRequest {
  readonly domain: string;
  readonly scenarioDescription: string;
  readonly language: CourseLanguage;
  readonly difficulty: CourseDifficulty;
  readonly documents?: readonly CourseDocumentInput[];
}

export interface GenerateCourseAccepted {
  readonly id: string;
  readonly courseId: string;
  readonly status: 'generating';
  readonly domainLabel: string;
}
