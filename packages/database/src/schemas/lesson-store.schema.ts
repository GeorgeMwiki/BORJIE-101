/**
 * reflexion_lessons — Drizzle schema (migration 0166).
 *
 * Persistent backing for the `LessonStore` port declared in
 * `packages/ai-copilot/src/reflexion/types.ts` (in-memory impl in
 * `packages/ai-copilot/src/reflexion/lesson-store.ts`).
 *
 * Lessons are per-(tenant_id, task_tag) bucketed Reflexion teaching
 * material distilled from CoT traces. The renderer reads up to N
 * lessons ordered by `recency_score DESC, created_at DESC` and embeds
 * them at the TOP of the next turn's system prompt for the same bucket.
 *
 * SOC 2 / GDPR Art. 30 rationale:
 *   - tenant_id mandatory ⇒ no cross-tenant lesson leak.
 *   - PII is already stripped by the distill stage. The `lesson` column
 *     holds short imperative sentences only; the `evidence` column is a
 *     short pointer back to the originating trace id, never raw user
 *     text.
 *   - `created_at` + `lesson_id` are immutable; only `recency_score`
 *     mutates (LRU + dedup bump). That preserves the audit trail.
 */

import {
  pgTable,
  text,
  doublePrecision,
  timestamp,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';

export const reflexionLessons = pgTable(
  'reflexion_lessons',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    taskTag: text('task_tag').notNull(),
    /** Short imperative sentence (max LESSON_MAX_CHARS = 240). */
    lesson: text('lesson').notNull(),
    /** Short reference: e.g. `trace:abc / step 3 / tool=search`. */
    evidence: text('evidence').notNull(),
    /** ISO-8601 of creation — frozen after insert. */
    createdAt: text('created_at').notNull(),
    /** [0, 1] LRU score; mutated by deduplication bumps. */
    recencyScore: doublePrecision('recency_score').notNull().default(0),
    /** Insertion timestamp — useful for retention sweeps. */
    insertedAt: timestamp('inserted_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    /**
     * (tenant, task_tag, lesson) uniqueness ⇒ the dedup-bump path can
     * `ON CONFLICT DO UPDATE` the recency_score in a single statement.
     */
    bucketLessonUniq: uniqueIndex(
      'uniq_reflexion_lessons_tenant_tag_lesson',
    ).on(t.tenantId, t.taskTag, t.lesson),
    /** Recency-sorted scan inside a bucket. */
    bucketRecencyIdx: index('idx_reflexion_lessons_bucket_recency').on(
      t.tenantId,
      t.taskTag,
      t.recencyScore,
    ),
  }),
);

export type ReflexionLessonRow = typeof reflexionLessons.$inferSelect;
export type NewReflexionLessonRow = typeof reflexionLessons.$inferInsert;
