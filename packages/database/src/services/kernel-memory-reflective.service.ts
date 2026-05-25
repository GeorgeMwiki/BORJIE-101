/**
 * Kernel memory — reflective service.
 *
 * Drizzle-backed adapter for the `kernel_memory_reflective` table
 * (migration 0121). Operations:
 *
 *   - latest(args) : fetch the N most recent digests for a (tenant,
 *                    user, periodKind) tuple, newest-first.
 *                    NB: this service exposes the read+write surface;
 *                    the consolidation cycle agent owns POPULATING the
 *                    table — fact extraction and roll-up are NOT this
 *                    service's job.
 *   - record(d)    : insert a precomputed digest. Idempotent on the
 *                    primary key only — same period can be re-written
 *                    by emitting a fresh id (the consolidation cycle's
 *                    responsibility).
 *
 * Hard DB failures degrade to no-op / [] so the kernel never crashes.
 */

import { randomUUID } from 'crypto';
import { and, eq, isNull, desc } from 'drizzle-orm';
import { kernelMemoryReflective } from '../schemas/kernel-memory-reflective.schema.js';
import type { DatabaseClient } from '../client.js';
import { logger } from '../logger.js';


export type ReflectivePeriodKind = 'daily' | 'weekly' | 'monthly';

export interface ReflectiveTopicCount {
  readonly topic: string;
  readonly count: number;
}

export interface ReflectiveDigest {
  readonly id: string;
  readonly tenantId: string | null;
  readonly userId: string | null;
  readonly periodKind: ReflectivePeriodKind;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly summary: string;
  readonly topTopics: ReadonlyArray<ReflectiveTopicCount>;
  readonly sentimentAvg: number | null;
  readonly actionItems: ReadonlyArray<string>;
  readonly generatedAt: string;
}

export interface ReflectiveDigestInput {
  readonly tenantId: string | null;
  readonly userId?: string | null;
  readonly periodKind: ReflectivePeriodKind;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly summary: string;
  readonly topTopics?: ReadonlyArray<ReflectiveTopicCount>;
  readonly sentimentAvg?: number | null;
  readonly actionItems?: ReadonlyArray<string>;
}

export interface LatestArgs {
  readonly tenantId: string | null;
  readonly userId?: string | null;
  readonly periodKind: ReflectivePeriodKind;
  readonly n?: number;
}

export interface ReflectiveMemoryService {
  latest(args: LatestArgs): Promise<ReadonlyArray<ReflectiveDigest>>;
  record(digest: ReflectiveDigestInput): Promise<void>;
}

const DEFAULT_LATEST_N = 1;

export function createReflectiveMemoryService(
  db: DatabaseClient,
): ReflectiveMemoryService {
  return {
    async latest(args) {
      try {
        const n = clampLimit(args.n, DEFAULT_LATEST_N);
        const conds = [eq(kernelMemoryReflective.periodKind, args.periodKind)];
        if (args.tenantId)
          conds.push(eq(kernelMemoryReflective.tenantId, args.tenantId));
        if (args.userId === null || args.userId === undefined) {
          conds.push(isNull(kernelMemoryReflective.userId));
        } else {
          conds.push(eq(kernelMemoryReflective.userId, args.userId));
        }

        const rows = await db
          .select(SELECT_COLS)
          .from(kernelMemoryReflective)
          .where(and(...conds))
          .orderBy(desc(kernelMemoryReflective.periodStart))
          .limit(n);

        return (rows ?? []).map(rowToDigest);
      } catch (error) {
        logger.error('kernel-memory-reflective.latest failed', { error: error });
        return [];
      }
    },

    async record(digest) {
      try {
        if (!digest.summary) return;
        await db
          .insert(kernelMemoryReflective)
          .values({
            id: randomUUID(),
            tenantId: digest.tenantId,
            userId: digest.userId ?? null,
            periodKind: digest.periodKind,
            periodStart: new Date(digest.periodStart),
            periodEnd: new Date(digest.periodEnd),
            summary: digest.summary,
            topTopics: (digest.topTopics ?? []) as never,
            sentimentAvg: digest.sentimentAvg ?? null,
            actionItems: (digest.actionItems ?? []) as never,
          } as never)
          .onConflictDoNothing();
      } catch (error) {
        logger.error('kernel-memory-reflective.record failed', { error: error });
      }
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

const SELECT_COLS = {
  id: kernelMemoryReflective.id,
  tenantId: kernelMemoryReflective.tenantId,
  userId: kernelMemoryReflective.userId,
  periodKind: kernelMemoryReflective.periodKind,
  periodStart: kernelMemoryReflective.periodStart,
  periodEnd: kernelMemoryReflective.periodEnd,
  summary: kernelMemoryReflective.summary,
  topTopics: kernelMemoryReflective.topTopics,
  sentimentAvg: kernelMemoryReflective.sentimentAvg,
  actionItems: kernelMemoryReflective.actionItems,
  generatedAt: kernelMemoryReflective.generatedAt,
} as const;

function clampLimit(input: number | undefined, fallback: number): number {
  if (typeof input !== 'number' || !Number.isFinite(input) || input <= 0) {
    return fallback;
  }
  return Math.min(Math.floor(input), 50);
}

interface ReflectiveRow {
  id: string;
  tenantId: string | null;
  userId: string | null;
  periodKind: string;
  periodStart: Date | string;
  periodEnd: Date | string;
  summary: string;
  topTopics: unknown;
  sentimentAvg: number | null;
  actionItems: unknown;
  generatedAt: Date | string;
}

function rowToDigest(row: ReflectiveRow): ReflectiveDigest {
  const topTopics = Array.isArray(row.topTopics)
    ? row.topTopics
        .filter(
          (t): t is { topic?: unknown; count?: unknown } =>
            t !== null && typeof t === 'object',
        )
        .map((t) => ({
          topic: String((t as { topic?: unknown }).topic ?? ''),
          count: Number((t as { count?: unknown }).count ?? 0),
        }))
        .filter((t) => t.topic.length > 0)
    : [];
  const actionItems = Array.isArray(row.actionItems)
    ? row.actionItems.map(String)
    : [];
  return {
    id: row.id,
    tenantId: row.tenantId,
    userId: row.userId,
    periodKind: row.periodKind as ReflectivePeriodKind,
    periodStart:
      row.periodStart instanceof Date
        ? row.periodStart.toISOString()
        : String(row.periodStart),
    periodEnd:
      row.periodEnd instanceof Date
        ? row.periodEnd.toISOString()
        : String(row.periodEnd),
    summary: row.summary,
    topTopics,
    sentimentAvg:
      row.sentimentAvg === null || row.sentimentAvg === undefined
        ? null
        : Number(row.sentimentAvg),
    actionItems,
    generatedAt:
      row.generatedAt instanceof Date
        ? row.generatedAt.toISOString()
        : String(row.generatedAt),
  };
}
