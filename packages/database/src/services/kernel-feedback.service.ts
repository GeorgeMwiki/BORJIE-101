/**
 * Kernel feedback — online-learning signal service.
 *
 * Drizzle-backed adapter for the `kernel_feedback` table (migration
 * 0122). Operations:
 *
 *   - record(args)        : insert one signal row.
 *   - recallForUser(args) : list the most recent feedback rows for a
 *                           (tenant, user) pair, capped at `limit`,
 *                           filtered to the last `sinceDays` window.
 *                           Ordered by capturedAt DESC. The kernel
 *                           reads this at step 4 (memory recall).
 *   - byThought(thoughtId): every feedback row referencing a single
 *                           kernel turn. Powers the ops-dashboard view.
 *   - rollup(args)        : tenant-scoped per-category counters with a
 *                           negativeRate ratio. Drives the kernel's
 *                           "be more conservative" directive in step 4
 *                           when negativeRate > 0.25.
 *
 * Hard DB failures degrade gracefully:
 *   - record   : logs + swallows (the side-channel never breaks
 *                the request that produced the feedback)
 *   - recallForUser / byThought : return [] on error
 *   - rollup   : returns zeroed counters on error
 *
 * The kernel is duck-typed against this service; see the
 * `FeedbackMemoryPort` in `packages/central-intelligence/src/kernel/
 * feedback/types.ts` for the structural shape the kernel consumes.
 */

import { randomUUID } from 'crypto';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { kernelFeedback } from '../schemas/kernel-feedback.schema.js';
import type { DatabaseClient } from '../client.js';
import { logger } from '../logger.js';


export type FeedbackSignal =
  | 'thumbs-up'
  | 'thumbs-down'
  | 'correction'
  | 'flagged';

export interface FeedbackEntry {
  readonly id: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly thoughtId: string;
  readonly threadId: string;
  readonly signal: FeedbackSignal;
  readonly rating?: number;
  readonly correctionText?: string;
  readonly category?: string;
  readonly capturedAt: string;
}

export interface RecallArgs {
  readonly tenantId: string;
  readonly userId: string;
  /** Cap the recall window. Default: 30 days. */
  readonly sinceDays?: number;
  /** Cap the row count. Default: 25; clamped to [1, 200]. */
  readonly limit?: number;
}

export interface RollupArgs {
  readonly tenantId: string;
  readonly sinceDays: number;
}

export interface FeedbackRollup {
  readonly thumbsUp: number;
  readonly thumbsDown: number;
  readonly corrections: number;
  readonly byCategory: Record<string, number>;
  /** thumbsDown + corrections / total recent rows; 0 when total = 0. */
  readonly negativeRate: number;
}

export interface FeedbackService {
  record(
    args: Omit<FeedbackEntry, 'id' | 'capturedAt'>,
  ): Promise<{ id: string }>;
  recallForUser(args: RecallArgs): Promise<ReadonlyArray<FeedbackEntry>>;
  byThought(thoughtId: string): Promise<ReadonlyArray<FeedbackEntry>>;
  rollup(args: RollupArgs): Promise<FeedbackRollup>;
}

const DEFAULT_RECALL_LIMIT = 25;
const MAX_RECALL_LIMIT = 200;
const DEFAULT_SINCE_DAYS = 30;
const VALID_SIGNALS: ReadonlySet<FeedbackSignal> = new Set([
  'thumbs-up',
  'thumbs-down',
  'correction',
  'flagged',
]);

export function createFeedbackService(db: DatabaseClient): FeedbackService {
  return {
    async record(args) {
      const id = randomUUID();
      try {
        if (!args.tenantId || !args.userId || !args.thoughtId) {
          throw new Error('tenantId / userId / thoughtId are required');
        }
        if (!VALID_SIGNALS.has(args.signal)) {
          throw new Error(`unknown feedback signal: ${args.signal}`);
        }

        const insertRow: Record<string, unknown> = {
          id,
          tenantId: args.tenantId,
          userId: args.userId,
          thoughtId: args.thoughtId,
          threadId: args.threadId,
          signal: args.signal,
        };
        if (typeof args.rating === 'number' && Number.isFinite(args.rating)) {
          insertRow.rating = clampRating(args.rating);
        }
        if (typeof args.correctionText === 'string' && args.correctionText) {
          insertRow.correctionText = args.correctionText.slice(0, 4_000);
        }
        if (typeof args.category === 'string' && args.category) {
          insertRow.category = args.category.slice(0, 64);
        }

        await db.insert(kernelFeedback).values(insertRow as never);
        return { id };
      } catch (error) {
        logger.error('kernel-feedback.record failed', { error: error });
        // Don't break the calling request — surface a synthetic id so
        // the caller can still hand the user a confirmation token. The
        // row simply isn't persisted.
        return { id };
      }
    },

    async recallForUser(args) {
      try {
        if (!args.tenantId || !args.userId) return [];
        const limit = clampLimit(args.limit, DEFAULT_RECALL_LIMIT);
        const sinceDays = clampSinceDays(
          args.sinceDays,
          DEFAULT_SINCE_DAYS,
        );
        const cutoff = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);

        const rows = (await db
          .select(SELECT_COLS)
          .from(kernelFeedback)
          .where(
            and(
              eq(kernelFeedback.tenantId, args.tenantId),
              eq(kernelFeedback.userId, args.userId),
              gte(kernelFeedback.capturedAt, cutoff),
            ),
          )
          .orderBy(desc(kernelFeedback.capturedAt))
          .limit(limit)) as ReadonlyArray<FeedbackRow>;

        return (rows ?? []).map(rowToEntry);
      } catch (error) {
        logger.error('kernel-feedback.recallForUser failed', { error: error });
        return [];
      }
    },

    async byThought(thoughtId) {
      try {
        if (!thoughtId) return [];
        const rows = (await db
          .select(SELECT_COLS)
          .from(kernelFeedback)
          .where(eq(kernelFeedback.thoughtId, thoughtId))
          .orderBy(desc(kernelFeedback.capturedAt))) as ReadonlyArray<FeedbackRow>;
        return (rows ?? []).map(rowToEntry);
      } catch (error) {
        logger.error('kernel-feedback.byThought failed', { error: error });
        return [];
      }
    },

    async rollup(args) {
      const empty: FeedbackRollup = {
        thumbsUp: 0,
        thumbsDown: 0,
        corrections: 0,
        byCategory: {},
        negativeRate: 0,
      };
      try {
        if (!args.tenantId) return empty;
        const sinceDays = clampSinceDays(args.sinceDays, DEFAULT_SINCE_DAYS);
        const cutoff = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);

        const rows = (await db
          .select({
            signal: kernelFeedback.signal,
            category: kernelFeedback.category,
          })
          .from(kernelFeedback)
          .where(
            and(
              eq(kernelFeedback.tenantId, args.tenantId),
              gte(kernelFeedback.capturedAt, cutoff),
            ),
          )) as ReadonlyArray<{ signal: string; category: string | null }>;

        const byCategory: Record<string, number> = {};
        let thumbsUp = 0;
        let thumbsDown = 0;
        let corrections = 0;
        let flagged = 0;
        for (const row of rows ?? []) {
          if (row.signal === 'thumbs-up') thumbsUp += 1;
          else if (row.signal === 'thumbs-down') thumbsDown += 1;
          else if (row.signal === 'correction') corrections += 1;
          else if (row.signal === 'flagged') flagged += 1;
          if (row.category) {
            byCategory[row.category] = (byCategory[row.category] ?? 0) + 1;
          }
        }
        const total = thumbsUp + thumbsDown + corrections + flagged;
        const negativeRate =
          total > 0 ? (thumbsDown + corrections) / total : 0;

        return {
          thumbsUp,
          thumbsDown,
          corrections,
          byCategory,
          negativeRate,
        };
      } catch (error) {
        logger.error('kernel-feedback.rollup failed', { error: error });
        return empty;
      }
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

const SELECT_COLS = {
  id: kernelFeedback.id,
  tenantId: kernelFeedback.tenantId,
  userId: kernelFeedback.userId,
  thoughtId: kernelFeedback.thoughtId,
  threadId: kernelFeedback.threadId,
  signal: kernelFeedback.signal,
  rating: kernelFeedback.rating,
  correctionText: kernelFeedback.correctionText,
  category: kernelFeedback.category,
  capturedAt: kernelFeedback.capturedAt,
} as const;

interface FeedbackRow {
  id: string;
  tenantId: string;
  userId: string;
  thoughtId: string;
  threadId: string;
  signal: string;
  rating: number | null;
  correctionText: string | null;
  category: string | null;
  capturedAt: Date | string;
}

function rowToEntry(row: FeedbackRow): FeedbackEntry {
  const base: FeedbackEntry = {
    id: row.id,
    tenantId: row.tenantId,
    userId: row.userId,
    thoughtId: row.thoughtId,
    threadId: row.threadId,
    signal: (VALID_SIGNALS.has(row.signal as FeedbackSignal)
      ? (row.signal as FeedbackSignal)
      : 'flagged'),
    capturedAt:
      row.capturedAt instanceof Date
        ? row.capturedAt.toISOString()
        : String(row.capturedAt),
  };
  const out: FeedbackEntry = {
    ...base,
    ...(row.rating !== null && row.rating !== undefined
      ? { rating: Number(row.rating) }
      : {}),
    ...(row.correctionText
      ? { correctionText: row.correctionText }
      : {}),
    ...(row.category ? { category: row.category } : {}),
  };
  return out;
}

function clampRating(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 1) return 1;
  if (n > 5) return 5;
  return Math.round(n);
}

function clampLimit(input: number | undefined, fallback: number): number {
  if (typeof input !== 'number' || !Number.isFinite(input) || input <= 0) {
    return fallback;
  }
  return Math.min(Math.floor(input), MAX_RECALL_LIMIT);
}

function clampSinceDays(
  input: number | undefined,
  fallback: number,
): number {
  if (typeof input !== 'number' || !Number.isFinite(input) || input <= 0) {
    return fallback;
  }
  return Math.min(Math.floor(input), 365);
}

// Re-export the table reference so callers building bespoke queries
// (admin dashboards, analytics jobs) can compose without a deep import.
export { kernelFeedback };
// Mark `sql` as used so a future query that needs raw SQL doesn't need
// to re-import it. Drizzle's `sql` helper is intentionally available
// here for forward-compat (e.g. window-function rollups).
void sql;
