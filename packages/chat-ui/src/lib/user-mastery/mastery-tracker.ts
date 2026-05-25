/**
 * mastery-tracker — pure scoring + a thin recorder facade.
 *
 * `computeMasteryScore(records)` is intentionally pure: it takes an
 * array of (action, count, lastSeen) tuples and returns a `MasteryScore`.
 * No I/O, no `Date.now()` reads when called with an explicit `now`,
 * deterministic. Tests pin the boundary transitions through this fn.
 *
 * `recordUserAction(store, event)` is the side-effectful entry point —
 * it delegates to a `UserActionStore` adapter so the same code runs
 * against a real Drizzle repo, an in-memory test fake, or a remote
 * gateway client without leaking storage details upward.
 *
 * Recency model:
 *   - actions last touched within `RECENT_WINDOW_MS` (7 days) count
 *     at full weight (1.0)
 *   - actions older than `STALE_WINDOW_MS` (90 days) count at the
 *     floor (0.25)
 *   - linear interpolation between the two boundaries
 *
 * The recency weight is applied to the TOTAL action count, not to
 * each record, because what we care about for progressive disclosure
 * is "is this user still engaged?" — a high count from a year ago
 * should not unlock advanced UI if the user has gone dormant.
 */

import type {
  MasteryScore,
  UserActionEvent,
  UserActionRecord,
  UserActionStore,
} from './types.js';
import {
  levelFromWeightedActions,
  nextLevelAbove,
  nextThresholdAbove,
} from './mastery-policy.js';

/** Actions within this window contribute at full weight. */
export const RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** Actions older than this floor at MIN_RECENCY_WEIGHT. */
export const STALE_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;
/** Recency-weight floor — keeps dormant users out of the top tier. */
export const MIN_RECENCY_WEIGHT = 0.25;

export interface ComputeOptions {
  /** Override "now" for deterministic tests. Defaults to Date.now(). */
  readonly now?: number;
}

/**
 * Compute the per-user mastery score from a slice of action records.
 *
 * Pure. Given the same inputs (records, now) you get the same output.
 * Returns the novice baseline when records is empty.
 */
export function computeMasteryScore(
  records: ReadonlyArray<UserActionRecord>,
  options: ComputeOptions = {},
): MasteryScore {
  if (records.length === 0) {
    return {
      level: 'novice',
      totalActions: 0,
      distinctActions: 0,
      recencyWeight: 1,
      weightedScore: 0,
      nextThreshold: nextThresholdAbove('novice'),
      nextLevel: nextLevelAbove('novice'),
    };
  }

  const now = options.now ?? Date.now();
  const totalActions = records.reduce(
    (sum, record) => sum + Math.max(0, record.actionCount),
    0,
  );
  const distinctActions = new Set(records.map((r) => r.actionId)).size;

  // Recency: take the MOST recent lastSeen across all records. A user
  // who used one feature yesterday is "active" even if their other
  // records are stale.
  let mostRecentMs = 0;
  for (const record of records) {
    const ts = Date.parse(record.lastSeen);
    if (Number.isFinite(ts) && ts > mostRecentMs) mostRecentMs = ts;
  }

  const recencyWeight = computeRecencyWeight(mostRecentMs, now);
  const weightedScore = Math.round(totalActions * recencyWeight);
  const level = levelFromWeightedActions(weightedScore);

  return {
    level,
    totalActions,
    distinctActions,
    recencyWeight,
    weightedScore,
    nextThreshold: nextThresholdAbove(level),
    nextLevel: nextLevelAbove(level),
  };
}

/**
 * Linear-interpolated recency weight in [MIN_RECENCY_WEIGHT, 1.0].
 *
 *   age <= RECENT_WINDOW_MS         → 1.0
 *   age >= STALE_WINDOW_MS          → MIN_RECENCY_WEIGHT
 *   between                         → linear blend
 *   mostRecentMs <= 0 (no activity) → MIN_RECENCY_WEIGHT
 */
export function computeRecencyWeight(
  mostRecentMs: number,
  nowMs: number,
): number {
  if (!Number.isFinite(mostRecentMs) || mostRecentMs <= 0) {
    return MIN_RECENCY_WEIGHT;
  }
  const ageMs = Math.max(0, nowMs - mostRecentMs);
  if (ageMs <= RECENT_WINDOW_MS) return 1;
  if (ageMs >= STALE_WINDOW_MS) return MIN_RECENCY_WEIGHT;
  const span = STALE_WINDOW_MS - RECENT_WINDOW_MS;
  const traveled = ageMs - RECENT_WINDOW_MS;
  const decay = (1 - MIN_RECENCY_WEIGHT) * (traveled / span);
  return Math.max(MIN_RECENCY_WEIGHT, 1 - decay);
}

/**
 * Side-effectful recorder. Delegates persistence to the adapter so the
 * tracker stays storage-agnostic. The returned record is the row AFTER
 * the upsert (count incremented).
 *
 * Validation is shallow on purpose — the adapter / database tier owns
 * tenant scoping enforcement via RLS. We reject only obviously
 * malformed inputs so a fat-fingered caller fails loudly here instead
 * of silently writing junk.
 */
export async function recordUserAction(
  store: UserActionStore,
  event: UserActionEvent,
): Promise<UserActionRecord> {
  if (!event.tenantId || typeof event.tenantId !== 'string') {
    throw new Error('recordUserAction: tenantId is required');
  }
  if (!event.userId || typeof event.userId !== 'string') {
    throw new Error('recordUserAction: userId is required');
  }
  if (!event.actionId || typeof event.actionId !== 'string') {
    throw new Error('recordUserAction: actionId is required');
  }
  try {
    return await store.upsert(event);
  } catch (error) {
    // Wrap so callers always see a single error type without losing
    // the original cause. Progressive-disclosure is a UX nicety —
    // failures here MUST NOT block the action the user just took.
    const cause = error instanceof Error ? error : new Error(String(error));
    const wrapped = new Error(
      `recordUserAction: failed to persist action '${event.actionId}': ${cause.message}`,
    );
    (wrapped as { cause?: unknown }).cause = cause;
    throw wrapped;
  }
}

/**
 * Convenience helper for callers that already hold a list of records:
 * read once, compute, hand back to the React layer.
 */
export async function loadMasteryScore(
  store: UserActionStore,
  tenantId: string,
  userId: string,
  options: ComputeOptions = {},
): Promise<MasteryScore> {
  const records = await store.read(tenantId, userId);
  return computeMasteryScore(records, options);
}
