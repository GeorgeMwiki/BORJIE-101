/**
 * Course-generation service — ports + DTOs.
 *
 * The Hono route owns the SQL I/O and (optionally) wires an `LLMPort` built
 * from the brain LLM router adapters; this service owns the persistence
 * contract + the generation orchestration. Mirrors the scenario-repository
 * port pattern so the generation logic stays unit-testable without a database
 * or a live model.
 *
 * Ported from the BossNyumba courses service types and retargeted real-estate
 * -> mining.
 *
 * @module services/courses/types
 */

import type {
  CourseDifficulty,
  CourseGenerationSource,
  CourseLanguage,
  CourseSummary,
  CourseWithLessons,
  GeneratedCourse,
} from '@borjie/ai-copilot/courses';

/** A document the learner attached at kickoff. */
export interface CourseDocumentInput {
  readonly documentId: string;
  readonly documentName: string;
  readonly documentType: string;
  readonly summary: string;
  readonly extractedData: Record<string, unknown>;
}

/** Args to create a placeholder course (fast path, before generation). */
export interface CreateCoursePlaceholderArgs {
  readonly tenantId: string;
  readonly userId: string;
  readonly domain: string;
  readonly scenarioDescription: string;
  readonly difficulty: CourseDifficulty;
  readonly language: CourseLanguage;
  readonly documents: ReadonlyArray<CourseDocumentInput>;
}

/** Args to finalise a placeholder once generation settles. */
export interface FinalizeCourseArgs {
  readonly tenantId: string;
  readonly userId: string;
  readonly courseId: string;
  readonly course: GeneratedCourse;
  readonly generatedVia: CourseGenerationSource;
}

/**
 * Persistence boundary. Every method is tenant + owner scoped (defence in
 * depth on top of RLS) — implemented by the Hono route over the shared drizzle
 * client. Kept as a port so the service has no direct DB import.
 */
export interface CoursesRepo {
  createPlaceholder(args: CreateCoursePlaceholderArgs): Promise<string>;
  finalize(args: FinalizeCourseArgs): Promise<void>;
  markFailed(
    tenantId: string,
    userId: string,
    courseId: string,
    message: string,
  ): Promise<void>;
  list(tenantId: string, userId: string): Promise<ReadonlyArray<CourseSummary>>;
  get(
    tenantId: string,
    userId: string,
    courseId: string,
  ): Promise<CourseWithLessons | null>;
}

/**
 * LLM seam. When wired, the service hands it to the `CourseGenerator`; when
 * null, the generator runs the deterministic catalog sequencer (honest-
 * degrade, never fabricates).
 */
export interface LLMPort {
  complete(prompt: string): Promise<string>;
}

/** Domain error carrying a stable code the route maps to an HTTP status. */
export class CourseServiceError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'CourseServiceError';
    this.code = code;
  }
}
