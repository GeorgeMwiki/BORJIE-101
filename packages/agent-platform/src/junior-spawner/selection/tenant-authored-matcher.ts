/**
 * Tenant-authored-junior matcher (Wave 18V-DYNAMIC).
 *
 * Mirror of the spawned matcher but for the `tenant_authored`
 * provenance class. Tenant-authored juniors are created via the
 * admin portal (Tier 2 mutation) so they enter the lifecycle at
 * `shadow`, not `draft`.
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
 * Return the strongest tenant-authored junior eligible to take this
 * turn. Filters strictly to the caller's tenant_id — tenant-authored
 * juniors are NEVER shared cross-tenant.
 */
export function findTenantAuthoredMatch(
  pool: ReadonlyArray<PersistedJuniorRecord>,
  intent_keywords: ReadonlyArray<string>,
  audience: SpawnerAudience,
  tenant_id: string,
): MatcherResult {
  const eligible = pool.filter(
    (j) =>
      j.provenance === 'tenant_authored' &&
      j.tenant_id === tenant_id &&
      (j.lifecycle_status === 'shadow' ||
        j.lifecycle_status === 'live' ||
        j.lifecycle_status === 'locked'),
  );
  return topMatchInPool(eligible, intent_keywords, audience);
}
