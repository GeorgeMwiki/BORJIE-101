/**
 * Lesson store — Phase E gap-closure (P8 Gap 7).
 *
 * The `LessonStore` interface (port) lives in `types.ts`. This file
 * provides the in-memory implementation used by the post-turn pipeline
 * in tests and dev. A Drizzle-backed adapter is a follow-up (Wave-M);
 * the kernel code already segregates persistence behind narrow ports
 * (see `OutcomeRepository` in `learning-loop/types.ts`) so this slot
 * will be filled the same way.
 *
 * Per-tenant + per-task-tag isolation is enforced at the key level:
 * lessons land in disjoint buckets, and `recent()` only scans the
 * caller's bucket. Cross-tenant reads are impossible without a
 * tenant-id swap.
 */

import type { Lesson, LessonStore } from './types.js';

type BucketKey = `${string}::${string}`;

function bucketKey(tenantId: string, taskTag: string): BucketKey {
  return `${tenantId}::${taskTag}` as BucketKey;
}

/**
 * In-memory `LessonStore`. Suitable for tests + single-process dev.
 * Production should use the Drizzle adapter (TBD Wave-M).
 *
 * Behaviour:
 *   - `put` deduplicates by exact `lesson` text within a bucket; on a
 *     dup it returns the existing record with `recencyScore` bumped by
 *     +0.1 (capped at 1.0) and keeps the older `createdAt`.
 *   - `recent` returns up to `limit` lessons ordered by recencyScore
 *     desc, then createdAt desc as a tiebreaker.
 *   - `clear` wipes everything — test-only.
 */
export function createInMemoryLessonStore(): LessonStore {
  const buckets = new Map<BucketKey, Lesson[]>();

  return {
    async put(lesson: Lesson): Promise<Lesson> {
      const key = bucketKey(lesson.tenantId, lesson.taskTag);
      const bucket = buckets.get(key) ?? [];
      const dupIndex = bucket.findIndex((l) => l.lesson === lesson.lesson);

      if (dupIndex >= 0) {
        const existing = bucket[dupIndex]!;
        const bumped: Lesson = {
          ...existing,
          recencyScore: Math.min(1, existing.recencyScore + 0.1),
        };
        const next = bucket.slice();
        next[dupIndex] = bumped;
        buckets.set(key, next);
        return bumped;
      }

      buckets.set(key, [...bucket, lesson]);
      return lesson;
    },

    async recent(
      tenantId: string,
      taskTag: string,
      limit: number,
    ): Promise<ReadonlyArray<Lesson>> {
      const key = bucketKey(tenantId, taskTag);
      const bucket = buckets.get(key) ?? [];
      const sorted = bucket.slice().sort((a, b) => {
        if (b.recencyScore !== a.recencyScore) {
          return b.recencyScore - a.recencyScore;
        }
        // Newer first when scores tie.
        return b.createdAt.localeCompare(a.createdAt);
      });
      return sorted.slice(0, Math.max(0, limit));
    },

    async clear(): Promise<void> {
      buckets.clear();
    },
  };
}
