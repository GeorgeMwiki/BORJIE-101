/**
 * Spawned-junior matcher (Wave 18V-DYNAMIC).
 *
 * Filters the persistence layer to `provenance = 'spawned'` AND
 * `lifecycle_status IN ('shadow','live','locked')` — the spec §5
 * step 6. `draft` and `deprecated` juniors are explicitly excluded
 * from selection because:
 *
 *  - `draft` has not yet accepted any production traffic.
 *  - `deprecated` is read-only audit access.
 *
 * Delegates the scoring + tie-break to `seed-matcher.topMatchInPool`
 * so the algorithm is one canonical pure function.
 */

import {
  topMatchInPool,
  type MatcherResult,
} from './seed-matcher.js';
import type {
  PersistedJuniorRecord,
  SpawnerAudience,
} from '../types.js';

/**
 * Return the strongest spawned junior eligible to take this turn.
 * Returns `{ junior: null, score: 0 }` if no eligible match exists.
 */
export function findSpawnedMatch(
  pool: ReadonlyArray<PersistedJuniorRecord>,
  intent_keywords: ReadonlyArray<string>,
  audience: SpawnerAudience,
  tenant_id: string,
): MatcherResult {
  const eligible = pool.filter(
    (j) =>
      j.provenance === 'spawned' &&
      j.tenant_id === tenant_id &&
      (j.lifecycle_status === 'shadow' ||
        j.lifecycle_status === 'live' ||
        j.lifecycle_status === 'locked'),
  );
  return topMatchInPool(eligible, intent_keywords, audience);
}
