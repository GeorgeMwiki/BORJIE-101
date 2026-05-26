/**
 * Seed-junior matcher (Wave 18V-DYNAMIC).
 *
 * The 27 seed juniors enumerated in `JUNIOR_ARCHITECTURE_SPEC.md` are
 * global product config. This matcher takes the request's audience +
 * intent keywords and returns the highest-scoring seed candidate.
 *
 * Scoring is a deliberately simple keyword + audience overlap so the
 * algorithm is auditable end-to-end. The cognitive engine (Wave 18T)
 * is layered on top of this for production scoring; this module is
 * the pure-function fallback that the integration tests exercise.
 */

import type {
  PersistedJuniorRecord,
  SpawnerAudience,
} from '../types.js';

// ─────────────────────────────────────────────────────────────────────
// Result shape
// ─────────────────────────────────────────────────────────────────────

export interface MatcherResult {
  readonly junior: PersistedJuniorRecord | null;
  readonly score: number;
}

// ─────────────────────────────────────────────────────────────────────
// Pure scorer
// ─────────────────────────────────────────────────────────────────────

/**
 * Compute a 0..1 fitness score between a junior's research topics +
 * audiences and the inbound intent keywords + audience. Keyword
 * matching is case-insensitive, deterministic, and treats every
 * matched keyword as worth 1/N where N is the number of intent
 * keywords.
 */
export function scoreJuniorAgainstIntent(
  junior: PersistedJuniorRecord,
  intent_keywords: ReadonlyArray<string>,
  audience: SpawnerAudience,
): number {
  if (!junior.target_audiences.includes(audience)) {
    return 0;
  }
  if (intent_keywords.length === 0) {
    return 0;
  }

  const normalised_keywords = intent_keywords.map((kw) => kw.toLowerCase());
  const junior_corpus = [
    ...junior.scope.research_topics,
    junior.specialisation,
    junior.subtitle,
  ]
    .join(' ')
    .toLowerCase();

  const matches = normalised_keywords.filter((kw) => junior_corpus.includes(kw));
  return matches.length / normalised_keywords.length;
}

// ─────────────────────────────────────────────────────────────────────
// Top-match across a pool
// ─────────────────────────────────────────────────────────────────────

/**
 * Select the highest-scoring junior in `pool`. Ties are broken by
 * `avg_satisfaction` → `usage_count` → most-recent `last_used_at`
 * to match the policy in the spec §5.
 *
 * Returns `{ junior: null, score: 0 }` when the pool is empty or no
 * junior scores above 0.
 */
export function topMatchInPool(
  pool: ReadonlyArray<PersistedJuniorRecord>,
  intent_keywords: ReadonlyArray<string>,
  audience: SpawnerAudience,
): MatcherResult {
  if (pool.length === 0) {
    return { junior: null, score: 0 };
  }

  const scored = pool
    .map((junior) => ({
      junior,
      score: scoreJuniorAgainstIntent(junior, intent_keywords, audience),
    }))
    .filter((entry) => entry.score > 0);

  if (scored.length === 0) {
    return { junior: null, score: 0 };
  }

  const sorted = [...scored].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const a_sat = a.junior.avg_satisfaction ?? 0;
    const b_sat = b.junior.avg_satisfaction ?? 0;
    if (b_sat !== a_sat) return b_sat - a_sat;
    if (b.junior.usage_count !== a.junior.usage_count) {
      return b.junior.usage_count - a.junior.usage_count;
    }
    const a_used = a.junior.last_used_at?.getTime() ?? 0;
    const b_used = b.junior.last_used_at?.getTime() ?? 0;
    return b_used - a_used;
  });

  return sorted[0] ?? { junior: null, score: 0 };
}

/**
 * Filter `pool` to seed-provenance only, then run `topMatchInPool`.
 * Convenience wrapper for the orchestrator.
 */
export function findSeedMatch(
  pool: ReadonlyArray<PersistedJuniorRecord>,
  intent_keywords: ReadonlyArray<string>,
  audience: SpawnerAudience,
): MatcherResult {
  const seeds = pool.filter((j) => j.provenance === 'seed');
  return topMatchInPool(seeds, intent_keywords, audience);
}
