/**
 * lesson-store.service — Drizzle-backed adapter.
 *
 * Satisfies the `LessonStore` port declared in
 * `packages/ai-copilot/src/reflexion/types.ts`.
 *
 * The in-memory store remains the default; this adapter is opt-in at
 * the api-gateway / consolidation-worker composition root.
 *
 * Behaviour matches the in-memory implementation:
 *   - `put` deduplicates by exact `(tenantId, taskTag, lesson)` text;
 *     on a dup it bumps `recency_score` by +0.1 (capped at 1.0) and
 *     leaves the older `created_at` untouched.
 *   - `recent(tenantId, taskTag, limit)` returns up to `limit` rows
 *     ordered by recency_score DESC, then created_at DESC.
 *   - `clear` truncates every row — test-only.
 *
 * Tenant scoping:
 *   - Every query filters by `tenantId + taskTag`. Cross-tenant reads
 *     are impossible without a deliberate role swap.
 *
 * Error handling:
 *   - Read failures degrade to `[]` (the kernel still renders a system
 *     prompt without lessons; reflexion is opt-in teaching material).
 *   - Write failures log + return the input lesson unchanged so the
 *     post-turn pipeline never throws into the kernel turn.
 *
 * SOC 2 / GDPR Art. 30 rationale:
 *   - PII-stripped at distill time. `lesson` + `evidence` are short
 *     imperative + reference strings; no raw user input.
 *   - tenant_id mandatory ⇒ multi-tenant isolation enforced at the SQL
 *     layer; pairs with RLS migration 0155.
 *   - `created_at` + `id` immutable; only `recency_score` mutates.
 */

import { randomUUID } from 'crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import { reflexionLessons } from '../schemas/lesson-store.schema.js';
import type { DatabaseClient } from '../client.js';
import { logger } from '../logger.js';


/** Shape the service reads — SELECT_COLS subset; excludes insertedAt. */
interface ReflexionLessonRow {
  readonly id: string;
  readonly tenantId: string;
  readonly taskTag: string;
  readonly lesson: string;
  readonly evidence: string;
  readonly createdAt: string;
  readonly recencyScore: number;
}

// ─────────────────────────────────────────────────────────────────────
// Public port shape (mirrors packages/ai-copilot/src/reflexion/types.ts).
// Inlined here so this package does not compile-time-depend on the
// ai-copilot package — the kernel registers the adapter at the
// composition root via duck-typing.
// ─────────────────────────────────────────────────────────────────────

export interface Lesson {
  readonly id: string;
  readonly tenantId: string;
  readonly taskTag: string;
  readonly lesson: string;
  readonly evidence: string;
  readonly createdAt: string;
  readonly recencyScore: number;
}

export interface LessonStore {
  put(lesson: Lesson): Promise<Lesson>;
  recent(
    tenantId: string,
    taskTag: string,
    limit: number,
  ): Promise<ReadonlyArray<Lesson>>;
  clear(): Promise<void>;
}

const LESSON_MAX_CHARS = 240;
const MAX_RECENT_LIMIT = 200;
const RECENCY_BUMP = 0.1;

function clampRecency(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function rowToLesson(row: ReflexionLessonRow): Lesson {
  return Object.freeze({
    id: row.id,
    tenantId: row.tenantId,
    taskTag: row.taskTag,
    lesson: row.lesson,
    evidence: row.evidence,
    createdAt: row.createdAt,
    recencyScore: Number(row.recencyScore ?? 0),
  });
}

export function createLessonStoreService(db: DatabaseClient): LessonStore {
  return {
    async put(lesson) {
      try {
        if (!lesson.tenantId || !lesson.taskTag) {
          throw new Error(
            'lesson-store.put: tenantId / taskTag are required',
          );
        }
        const text = (lesson.lesson ?? '').slice(0, LESSON_MAX_CHARS);
        if (!text.trim()) {
          throw new Error('lesson-store.put: lesson text must not be empty');
        }
        const id = lesson.id || randomUUID();
        const recency = clampRecency(lesson.recencyScore ?? 0);

        // Atomic dedup-bump:
        //   INSERT ... ON CONFLICT (tenant_id, task_tag, lesson)
        //     DO UPDATE SET recency_score = LEAST(1.0, recency_score + 0.1)
        const inserted = (await db
          .insert(reflexionLessons)
          .values({
            id,
            tenantId: lesson.tenantId,
            taskTag: lesson.taskTag,
            lesson: text,
            evidence: lesson.evidence ?? '',
            createdAt: lesson.createdAt ?? new Date().toISOString(),
            recencyScore: recency,
          } as never)
          .onConflictDoUpdate({
            target: [
              reflexionLessons.tenantId,
              reflexionLessons.taskTag,
              reflexionLessons.lesson,
            ],
            set: {
              recencyScore: sql`LEAST(1.0, ${reflexionLessons.recencyScore} + ${RECENCY_BUMP})`,
            } as never,
          })
          .returning(SELECT_COLS)) as ReadonlyArray<ReflexionLessonRow>;

        const row = inserted?.[0];
        if (row) return rowToLesson(row);
        return Object.freeze({
          ...lesson,
          id,
          lesson: text,
          recencyScore: recency,
        });
      } catch (error) {
        logger.error('lesson-store.put failed', { error: error });
        // Don't throw — the post-turn pipeline must never break the
        // kernel turn just because reflexion persistence is unhealthy.
        return Object.freeze({
          ...lesson,
          recencyScore: clampRecency(lesson.recencyScore ?? 0),
        });
      }
    },

    async recent(tenantId, taskTag, limit) {
      try {
        if (!tenantId || !taskTag) return Object.freeze([]);
        const n = clampLimit(limit);
        if (n === 0) return Object.freeze([]);
        const rows = (await db
          .select(SELECT_COLS)
          .from(reflexionLessons)
          .where(
            and(
              eq(reflexionLessons.tenantId, tenantId),
              eq(reflexionLessons.taskTag, taskTag),
            ),
          )
          .orderBy(
            desc(reflexionLessons.recencyScore),
            desc(reflexionLessons.createdAt),
          )
          .limit(n)) as ReadonlyArray<ReflexionLessonRow>;
        return Object.freeze((rows ?? []).map(rowToLesson));
      } catch (error) {
        logger.error('lesson-store.recent failed', { error: error });
        return Object.freeze([]);
      }
    },

    async clear() {
      try {
        // Test-only — full wipe.
        await db.execute(sql`TRUNCATE TABLE reflexion_lessons`);
      } catch (error) {
        logger.error('lesson-store.clear failed', { error: error });
      }
    },
  };
}

function clampLimit(input: number): number {
  if (typeof input !== 'number' || !Number.isFinite(input) || input <= 0) {
    return 0;
  }
  return Math.min(Math.floor(input), MAX_RECENT_LIMIT);
}

const SELECT_COLS = {
  id: reflexionLessons.id,
  tenantId: reflexionLessons.tenantId,
  taskTag: reflexionLessons.taskTag,
  lesson: reflexionLessons.lesson,
  evidence: reflexionLessons.evidence,
  createdAt: reflexionLessons.createdAt,
  recencyScore: reflexionLessons.recencyScore,
} as const;

export { reflexionLessons };
