/**
 * Courses API service — client for /api/v1/courses/*.
 *
 * Backs the owner-cockpit create-course flow:
 *   - /training/create-course   (domain + scenario + documents -> generate)
 *   - /training/course/[id]     (generated course view + generation poller)
 *
 * All endpoints require a Supabase Bearer token; the signed-in operator is
 * derived server-side (the client never sends a user id). POST /generate returns
 * 202 with a placeholder course id; the FE polls `get(id)` until lessons appear
 * (or a generationError is surfaced).
 *
 * The owner-web pages drive these endpoints NATIVELY via their own gateway
 * client (their house data-layer convention); this service is the canonical
 * typed contract reused for the TYPE shapes (imported through the
 * `@borjie/api-client/courses-types` tsconfig path alias). Importing VALUE
 * (`coursesService`) goes through the barrel; importing TYPES goes through the
 * alias — sidestepping the NodeNext barrel-resolution pitfall.
 *
 * Ported from the BossNyumba courses service and retargeted real-estate ->
 * mining.
 */

import { getApiClient, ApiResponse } from '../client';

// Type shapes live in a pure-type module (zero runtime/client imports) so the
// `@borjie/api-client/courses-types` alias can resolve them without dragging
// `../client` into a strict app typecheck. Re-exported here to keep the runtime
// service and its typed contract single-sourced.
export type {
  CourseLanguage,
  CourseDifficulty,
  CourseStatus,
  CourseLessonStatus,
  CourseGenerationSource,
  CourseQuizQuestion,
  CourseLessonContent,
  CourseLessonRow,
  CourseSummary,
  CourseWithLessons,
  CourseDocumentInput,
  GenerateCourseRequest,
  GenerateCourseAccepted,
} from './courses.types';

import type {
  CourseSummary,
  CourseWithLessons,
  GenerateCourseRequest,
  GenerateCourseAccepted,
} from './courses.types';

export const coursesService = {
  /**
   * Kick off generation. Returns 202 with a placeholder course id immediately;
   * poll `get(id)` until lessons appear (or a generationError is surfaced).
   */
  generate(
    body: GenerateCourseRequest,
  ): Promise<ApiResponse<GenerateCourseAccepted>> {
    return getApiClient().post<GenerateCourseAccepted>('/courses/generate', body);
  },

  /** List my generated courses, newest first. */
  list(): Promise<ApiResponse<readonly CourseSummary[]>> {
    return getApiClient().get<readonly CourseSummary[]>('/courses');
  },

  /** Load one of my courses with its lessons. */
  get(courseId: string): Promise<ApiResponse<CourseWithLessons>> {
    return getApiClient().get<CourseWithLessons>(
      `/courses/${encodeURIComponent(courseId)}`,
    );
  },
};
