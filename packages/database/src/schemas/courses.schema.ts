/**
 * Courses schema (migration 0284).
 *
 * Borjie's owner cockpit can generate a tailored mining course on demand: the
 * operator picks a domain, describes their situation, optionally attaches
 * documents, and the brain (or the deterministic ESTATE_CONCEPTS sequencer)
 * generates a 5-to-8 lesson course. This schema backs the create-course surface
 * (owner-web /training/create-course + /training/course/[id]).
 *
 * Companion to:
 *   - packages/database/src/migrations/0284_courses.sql
 *   - packages/ai-copilot/src/courses/* (generator + deterministic sequencer)
 *   - services/api-gateway/src/services/courses/* + routes/courses.hono.ts
 *
 * Three tables:
 *   - courses           one row per generated course. The validated curriculum
 *                       snapshot lives in ai_generated_curriculum jsonb. A
 *                       `draft` row with lesson_count 0 + NULL generation_error
 *                       is "still generating"; a `draft` row WITH
 *                       generation_error is "failed".
 *   - course_lessons    normalised per-lesson rows for per-lesson progress.
 *   - course_documents  the documents the learner attached as grounding.
 *
 * Tenant scope (CLAUDE.md hard rule — mirrors training-scenarios.schema /
 * migration 0283): tenant_id is TEXT; `app.current_tenant_id` GUC RLS,
 * FORCE-enabled, bound by the api-gateway databaseMiddleware. Every query the
 * route runs is also tenant + owner filtered defensively. NEVER the legacy
 * app.tenant_id.
 *
 * Honest-degrade (CLAUDE.md hard rule): generated_via records 'llm' or
 * 'deterministic' so the UI can be transparent. Content is never fabricated.
 *
 * Ported from the BossNyumba courses schema and retargeted real-estate ->
 * mining.
 */

import {
  pgTable,
  text,
  timestamp,
  jsonb,
  uuid,
  integer,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// ── enum value catalogs (mirrored as CHECK constraints in mig 0284) ────────

/** Course lifecycle (a `draft` + generation_error row is the "failed" state). */
export const COURSE_STATUSES = ['draft', 'in_progress', 'completed'] as const;
export type CourseRowStatus = (typeof COURSE_STATUSES)[number];

/** Course difficulty — mirrors the concept catalog difficulty ladder. */
export const COURSE_DIFFICULTIES = [
  'beginner',
  'intermediate',
  'advanced',
] as const;
export type CourseRowDifficulty = (typeof COURSE_DIFFICULTIES)[number];

/** Honest-degrade provenance. */
export const COURSE_GENERATION_SOURCES = ['llm', 'deterministic'] as const;
export type CourseRowGenerationSource =
  (typeof COURSE_GENERATION_SOURCES)[number];

/** Per-lesson lifecycle. */
export const COURSE_LESSON_STATUSES = [
  'not_started',
  'in_progress',
  'completed',
] as const;
export type CourseLessonRowStatus = (typeof COURSE_LESSON_STATUSES)[number];

// ── courses ────────────────────────────────────────────────────────────────

export const courses = pgTable(
  'courses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    /** Operator — derived server-side from the verified JWT, never client-sent. */
    createdByUserId: text('created_by_user_id').notNull(),
    /** Selected mining domain id (see COURSE_DOMAINS). */
    domain: text('domain').notNull(),
    scenarioDescription: text('scenario_description').notNull().default(''),
    status: text('status').notNull().default('draft'),
    difficulty: text('difficulty').notNull().default('beginner'),
    language: text('language').notNull().default('en'),
    /**
     * The validated `GeneratedCourse` snapshot (title, summary, difficulty,
     * lessons). Empty object while generating. Never fabricated content.
     */
    aiGeneratedCurriculum: jsonb('ai_generated_curriculum').notNull().default({}),
    lessonCount: integer('lesson_count').notNull().default(0),
    /** 'llm' | 'deterministic' once generation settles; NULL while generating. */
    generatedVia: text('generated_via'),
    /** Set (status stays 'draft') when a background generation fails. */
    generationError: text('generation_error'),
    /** Attached-document ids snapshot (the grounding the learner supplied). */
    documentIds: jsonb('document_ids').notNull().default([]),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    tenantOwnerCreatedIdx: index('courses_tenant_owner_created').on(
      table.tenantId,
      table.createdByUserId,
      table.createdAt,
    ),
    tenantStatusIdx: index('courses_tenant_status').on(
      table.tenantId,
      table.status,
    ),
  }),
);

export type Course = typeof courses.$inferSelect;
export type NewCourse = typeof courses.$inferInsert;

// ── course_lessons ─────────────────────────────────────────────────────────

export const courseLessons = pgTable(
  'course_lessons',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    createdByUserId: text('created_by_user_id').notNull(),
    lessonNumber: integer('lesson_number').notNull(),
    lessonTitle: text('lesson_title').notNull().default(''),
    /** The validated `GeneratedLesson` snapshot (content, objectives, quiz). */
    lessonContent: jsonb('lesson_content').notNull().default({}),
    status: text('status').notNull().default('not_started'),
    /** Quiz score 0-100 once taken; NULL until then. */
    quizScore: integer('quiz_score'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    tenantCourseIdx: index('course_lessons_tenant_course').on(
      table.tenantId,
      table.courseId,
    ),
    courseNumberUq: uniqueIndex('course_lessons_course_number_uq').on(
      table.courseId,
      table.lessonNumber,
    ),
  }),
);

export type CourseLesson = typeof courseLessons.$inferSelect;
export type NewCourseLesson = typeof courseLessons.$inferInsert;

// ── course_documents ─────────────────────────────────────────────────────

export const courseDocuments = pgTable(
  'course_documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    createdByUserId: text('created_by_user_id').notNull(),
    documentId: text('document_id').notNull(),
    documentName: text('document_name').notNull().default(''),
    documentType: text('document_type').notNull().default(''),
    extractedData: jsonb('extracted_data').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    tenantCourseIdx: index('course_documents_tenant_course').on(
      table.tenantId,
      table.courseId,
    ),
  }),
);

export type CourseDocument = typeof courseDocuments.$inferSelect;
export type NewCourseDocument = typeof courseDocuments.$inferInsert;
