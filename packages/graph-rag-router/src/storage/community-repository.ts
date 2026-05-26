/**
 * Community repository — in-memory reference implementation of
 * `CommunityRepositoryPort`. Production wires Drizzle at composition
 * root.
 *
 * The repository keeps:
 *   - one bucket of communities per tenant
 *   - one bucket of summaries per tenant (keyed by communityId →
 *     latest CommunitySummary).
 *
 * Summaries are append-only in the persistent contract, but the
 * in-memory repo only retains the latest for a given communityId
 * because the only test that needs history is the sleep-pass test
 * which uses real Drizzle.
 */

import type {
  Community,
  CommunityRepositoryPort,
  CommunitySummary,
  Id,
} from '../types.js';

interface RepoState {
  readonly communitiesByTenant: Map<string, Map<Id, Community>>;
  readonly summariesByTenant: Map<string, Map<Id, CommunitySummary>>;
}

function getOrCreate<K, V>(map: Map<K, Map<K, V>>, key: K): Map<K, V> {
  const existing = map.get(key);
  if (existing !== undefined) return existing;
  const fresh = new Map<K, V>();
  map.set(key, fresh);
  return fresh;
}

export function createInMemoryCommunityRepository(): CommunityRepositoryPort {
  const state: RepoState = {
    communitiesByTenant: new Map(),
    summariesByTenant: new Map(),
  };
  return {
    async upsertCommunity({ tenantId, community }): Promise<void> {
      const bucket = getOrCreate(state.communitiesByTenant, tenantId);
      bucket.set(community.id, community);
    },
    async upsertSummary({ tenantId, summary }): Promise<void> {
      const bucket = getOrCreate(state.summariesByTenant, tenantId);
      bucket.set(summary.communityId, summary);
    },
    async listCommunities(tenantId): Promise<ReadonlyArray<Community>> {
      const bucket = state.communitiesByTenant.get(tenantId);
      if (bucket === undefined) return [];
      return Array.from(bucket.values());
    },
    async getLatestSummary({ tenantId, communityId }) {
      const bucket = state.summariesByTenant.get(tenantId);
      if (bucket === undefined) return null;
      return bucket.get(communityId) ?? null;
    },
  };
}
