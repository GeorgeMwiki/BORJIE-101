/**
 * FadeMem eviction — time-decay × LFU effective score, with a two-stage
 * soft / hard delete pipeline.
 *
 * Effective score per ADR:
 *
 *   ageDays  = (now - createdAt) / 86_400_000
 *   decay    = exp(-0.0231 * ageDays)           // half-life 30 days
 *   lfu      = 1 + 0.1 * ln(1 + accessCount)
 *   score    = importanceScore * decay * lfu
 *
 * Sweep policy:
 *
 *   - softDeleteSweep(threshold=0.1)  — mark `soft_deleted_at = NOW()`
 *                                       for every note where the
 *                                       effective score falls below
 *                                       the threshold AND
 *                                       `soft_deleted_at IS NULL`.
 *   - hardEvictSweep(olderThanDays=90) — physically delete every note
 *                                        whose `soft_deleted_at` is at
 *                                        least N days old.
 *
 * Pure logic + the same `EpisodicRepo` port used by episodic-amem.
 * The Drizzle-backed adapter implements `softDeleteBelow` /
 * `hardDeleteOlderThan` / `streamAll`.
 */

import type { EpisodicRepo, EpisodicSweepResult } from './types-amem.js';

/** ln(2) / 30 days — half-life decay rate per ADR. */
export const FADEMEM_DECAY_RATE = 0.0231;

/** Default soft-delete threshold. */
export const DEFAULT_SOFT_DELETE_THRESHOLD = 0.1;

/** Default hard-evict window. */
export const DEFAULT_HARD_EVICT_DAYS = 90;

/** One day in ms — exported so callers can compose timestamps. */
export const MS_PER_DAY = 86_400_000;

/**
 * The FadeMem effective score for a single note. Always non-negative;
 * tolerates malformed inputs (NaN createdAt / negative accessCount).
 */
export function effectiveScore(
  note: {
    readonly importance_score?: number;
    readonly importanceScore?: number;
    readonly created_at?: Date | string | number;
    readonly createdAt?: Date | string | number;
    readonly access_count?: number;
    readonly accessCount?: number;
  },
  now: Date,
): number {
  const importance = pickNumber(
    note.importance_score,
    note.importanceScore,
    0,
  );
  const createdMs = parseDateMs(note.created_at ?? note.createdAt);
  const accessCount = pickNumber(
    note.access_count,
    note.accessCount,
    0,
  );
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  if (!Number.isFinite(nowMs) || !Number.isFinite(createdMs)) return 0;

  const ageDays = Math.max(0, (nowMs - createdMs) / MS_PER_DAY);
  const decay = Math.exp(-FADEMEM_DECAY_RATE * ageDays);
  const lfu = 1 + 0.1 * Math.log(1 + Math.max(0, accessCount));
  const score = importance * decay * lfu;
  return Number.isFinite(score) && score > 0 ? score : 0;
}

/**
 * Sweep — soft-delete every note whose effective score < threshold.
 *
 * Two execution paths:
 *
 *   - If the repo exposes a SQL-side `softDeleteBelow`, delegate (the
 *     adapter implements the decay computation inside Postgres so we
 *     don't have to stream every row through the kernel).
 *   - Otherwise stream every note via `streamAll`, compute the score
 *     in JS, and call a hypothetical bulk soft-delete. The fallback
 *     path is what the in-memory repo fake uses.
 */
export async function softDeleteSweep(
  repo: EpisodicRepo,
  args: {
    readonly tenantId?: string;
    readonly threshold?: number;
    readonly now?: Date;
  } = {},
): Promise<number> {
  const threshold = args.threshold ?? DEFAULT_SOFT_DELETE_THRESHOLD;
  const now = args.now ?? new Date();

  if (typeof repo.softDeleteBelow === 'function') {
    const sqlArgs: { tenantId?: string; threshold: number; now: Date } = {
      threshold,
      now,
    };
    if (args.tenantId !== undefined) sqlArgs.tenantId = args.tenantId;
    return repo.softDeleteBelow(sqlArgs);
  }
  // In-memory fallback. Stream the live notes, classify, count.
  if (typeof repo.streamAll !== 'function') return 0;
  const streamArgs: { tenantId?: string } = {};
  if (args.tenantId !== undefined) streamArgs.tenantId = args.tenantId;
  const all = await repo.streamAll(streamArgs);
  let count = 0;
  for (const note of all) {
    if (note.softDeletedAt) continue;
    if (effectiveScore(note, now) < threshold) {
      count += 1;
    }
  }
  return count;
}

/**
 * Sweep — hard-delete every note soft-deleted ≥ N days ago.
 */
export async function hardEvictSweep(
  repo: EpisodicRepo,
  args: {
    readonly tenantId?: string;
    readonly olderThanDays?: number;
    readonly now?: Date;
  } = {},
): Promise<number> {
  const olderThanDays = args.olderThanDays ?? DEFAULT_HARD_EVICT_DAYS;
  const now = args.now ?? new Date();

  if (typeof repo.hardDeleteOlderThan === 'function') {
    const hardArgs: { tenantId?: string; olderThanDays: number; now: Date } = {
      olderThanDays,
      now,
    };
    if (args.tenantId !== undefined) hardArgs.tenantId = args.tenantId;
    return repo.hardDeleteOlderThan(hardArgs);
  }
  if (typeof repo.streamAll !== 'function') return 0;
  const streamArgs: { tenantId?: string } = {};
  if (args.tenantId !== undefined) streamArgs.tenantId = args.tenantId;
  const all = await repo.streamAll(streamArgs);
  const cutoff = now.getTime() - olderThanDays * MS_PER_DAY;
  let count = 0;
  for (const note of all) {
    if (!note.softDeletedAt) continue;
    const stamp =
      note.softDeletedAt instanceof Date
        ? note.softDeletedAt.getTime()
        : Number(note.softDeletedAt);
    if (Number.isFinite(stamp) && stamp <= cutoff) {
      count += 1;
    }
  }
  return count;
}

/**
 * Combined sweep — run soft-delete first, then hard-evict.
 */
export async function runEvictionSweep(
  repo: EpisodicRepo,
  args: {
    readonly tenantId?: string;
    readonly softThreshold?: number;
    readonly hardEvictDays?: number;
    readonly now?: Date;
  } = {},
): Promise<EpisodicSweepResult> {
  const now = args.now ?? new Date();
  const softArgs: { tenantId?: string; threshold?: number; now: Date } = { now };
  if (args.tenantId !== undefined) softArgs.tenantId = args.tenantId;
  if (args.softThreshold !== undefined) softArgs.threshold = args.softThreshold;
  const softDeleted = await softDeleteSweep(repo, softArgs);

  const hardArgs: { tenantId?: string; olderThanDays?: number; now: Date } = { now };
  if (args.tenantId !== undefined) hardArgs.tenantId = args.tenantId;
  if (args.hardEvictDays !== undefined) hardArgs.olderThanDays = args.hardEvictDays;
  const hardDeleted = await hardEvictSweep(repo, hardArgs);
  return { softDeleted, hardDeleted };
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function pickNumber(...vals: ReadonlyArray<unknown>): number {
  for (const v of vals) {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return 0;
}

function parseDateMs(v: Date | string | number | undefined): number {
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : Number.NaN;
  }
  return Number.NaN;
}
