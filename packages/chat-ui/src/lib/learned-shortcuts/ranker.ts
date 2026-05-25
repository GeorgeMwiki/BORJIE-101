/**
 * Learned-Shortcuts ranker.
 *
 * Pure scoring function — no React, no Supabase, no DOM. Lets us
 * unit-test the formula without any wiring and keeps the ranker
 * portable to a worker thread later if we need to score thousands of
 * actions client-side.
 *
 * Formula (per spec):
 *
 *   score(action) = log(1 + frequency)
 *                 * recencyWeight(lastSeen)
 *                 * (0.5 + 0.5 * confirmationRate)
 *
 *   recencyWeight(t) = exp(-(now - t) / halfLifeMs)
 *   confirmationRate = successCount / (successCount + cancelCount)
 *
 * Confirmation-rate is clamped to [0, 1] and defaults to 0.5 when no
 * outcome has been recorded yet (so a brand-new action neither gets
 * boosted nor demoted). Recency uses an exponential decay rather than
 * a hard cutoff so the score is continuous — important for animation
 * stability when the panel re-ranks.
 *
 * Pinned IDs short-circuit the formula entirely: any ID listed in
 * `pinnedIds` is forced to the top in the supplied order. The ranker
 * never invents a row for a pinned ID that isn't in the input.
 */

import type {
  LearnedShortcut,
  RankerOptions,
  UserActionTrackerRow,
} from './types.js';

/** Default recency half-life — one week. */
const DEFAULT_HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000;

/** Default top-N returned by `rankActions`. */
const DEFAULT_TOP_N = 5;

/** When no outcome data exists, use a neutral confirmation rate. */
const NEUTRAL_CONFIRMATION_RATE = 0.5;

/**
 * Compute the exponential-decay recency weight. `lastSeenMs` may be
 * in the future (clock drift) in which case the weight is clamped to
 * 1 — we never reward future timestamps but we don't punish them
 * either.
 */
export function recencyWeight(
  lastSeenMs: number,
  now: number,
  halfLifeMs: number = DEFAULT_HALF_LIFE_MS,
): number {
  if (!Number.isFinite(lastSeenMs) || !Number.isFinite(now)) return 0;
  if (halfLifeMs <= 0) return 0;
  const ageMs = now - lastSeenMs;
  if (ageMs <= 0) return 1;
  // log(2) divided by half-life gives the decay constant such that
  // exp(-k * halfLifeMs) = 0.5 — i.e. the weight halves over a week.
  const k = Math.LN2 / halfLifeMs;
  return Math.exp(-k * ageMs);
}

/**
 * Confirmation rate clamped to [0, 1]. Returns 0.5 when no outcomes
 * have been recorded so brand-new actions get a neutral multiplier.
 */
export function confirmationRate(
  successCount: number,
  cancelCount: number,
): number {
  const success = Math.max(0, successCount);
  const cancel = Math.max(0, cancelCount);
  const total = success + cancel;
  if (total <= 0) return NEUTRAL_CONFIRMATION_RATE;
  return success / total;
}

/**
 * Score a single action. Exported so consumers can sort by their own
 * tie-breakers, and so tests can assert raw scores without bouncing
 * through the array-shaping logic in `rankActions`.
 */
export function scoreAction(
  row: UserActionTrackerRow,
  now: number,
  halfLifeMs: number = DEFAULT_HALF_LIFE_MS,
): number {
  const frequency = Math.max(0, row.frequency);
  if (frequency <= 0) return 0;
  const last = Date.parse(row.lastSeenIso);
  if (Number.isNaN(last)) return 0;
  const freqTerm = Math.log1p(frequency);
  const recencyTerm = recencyWeight(last, now, halfLifeMs);
  const confTerm =
    0.5 + 0.5 * confirmationRate(row.successCount, row.cancelCount);
  return freqTerm * recencyTerm * confTerm;
}

/**
 * Build the ranked list of learned shortcuts.
 *
 * Pinned IDs are placed first (in caller-supplied order); the remaining
 * non-pinned rows are sorted by score descending and the top-N slot
 * is filled until we reach the cap. The returned `confidence` field is
 * a relative normalisation against the highest-scoring entry — letting
 * the panel render a single shared gradient without each app needing
 * to know the absolute score scale.
 */
export function rankActions(
  rows: ReadonlyArray<UserActionTrackerRow>,
  options: RankerOptions = {},
): ReadonlyArray<LearnedShortcut> {
  const now = options.now ?? Date.now();
  const halfLifeMs = options.halfLifeMs ?? DEFAULT_HALF_LIFE_MS;
  const topN = options.topN ?? DEFAULT_TOP_N;
  const pinnedIds = options.pinnedIds ?? [];

  if (rows.length === 0 || topN <= 0) return [];

  // Build a map for O(1) pin lookups + dedupe by row.id (last-write-wins
  // would surprise UI-3 contributors, so we keep the first row for each
  // ID and ignore duplicates).
  const byId = new Map<string, UserActionTrackerRow>();
  for (const row of rows) {
    if (!byId.has(row.id)) byId.set(row.id, row);
  }

  const pinnedSet = new Set(pinnedIds);

  // 1. Pinned entries first, in the order pinnedIds was supplied.
  const pinnedEntries: UserActionTrackerRow[] = [];
  for (const id of pinnedIds) {
    const row = byId.get(id);
    if (row) pinnedEntries.push(row);
  }

  // 2. Non-pinned entries sorted by score desc, tie-break by frequency
  //    then by id (stable, deterministic across runs).
  const scored = Array.from(byId.values())
    .filter((row) => !pinnedSet.has(row.id))
    .map((row) => ({ row, score: scoreAction(row, now, halfLifeMs) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.row.frequency !== a.row.frequency) {
        return b.row.frequency - a.row.frequency;
      }
      return a.row.id.localeCompare(b.row.id);
    });

  // 3. Concatenate, cap at topN.
  const combined: { row: UserActionTrackerRow; score: number }[] = [
    ...pinnedEntries.map((row, index) => ({
      row,
      // Synthetic "very large" score keeps pinned items ahead of ranked
      // items in any downstream sort. Order within pinned is preserved
      // by the negative index — pinnedIds[0] > pinnedIds[1] > ...
      score: Number.MAX_SAFE_INTEGER - index,
    })),
    ...scored,
  ].slice(0, topN);

  if (combined.length === 0) return [];

  // Normalise confidences against the top non-pinned score so pinned
  // items don't squash the gradient to zero. Fall back to 1 when the
  // only entries are pinned.
  const topScore = scored[0]?.score ?? combined[0]?.score ?? 1;
  const safeTop = topScore > 0 ? topScore : 1;

  return combined.map(({ row, score }) => {
    const isPinned = pinnedSet.has(row.id);
    const confidence = isPinned ? 1 : Math.min(1, score / safeTop);
    const out: LearnedShortcut = {
      id: row.id,
      label: row.label,
      confidence,
      ...(row.icon !== undefined ? { icon: row.icon } : {}),
      ...(row.route !== undefined ? { route: row.route } : {}),
    };
    return out;
  });
}
