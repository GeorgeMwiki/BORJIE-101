/**
 * In-memory `PostsRepository` adapter.
 *
 * Wave BLACKBOARD-CORE. Pure-memory adapter for tests + dev. Chains
 * `audit_hash` per region (spec §11): the first post in a region uses
 * `GENESIS_HASH`; subsequent posts use the previous post's
 * `audit_hash` as `prev_hash`.
 *
 * Each append is O(1) — the per-region tail hash is cached.
 */

import { randomUUID } from 'node:crypto';
import {
  type AppendPostInput,
  type Post,
  type PostsRepository,
} from '../types.js';
import { computeBlackboardHash, GENESIS_HASH } from '../audit/hash-chain.js';

interface InMemoryPostsRepositoryDeps {
  readonly now?: () => Date;
}

export function createInMemoryPostsRepository(
  deps: InMemoryPostsRepositoryDeps = {},
): PostsRepository {
  const now = deps.now ?? (() => new Date());
  const rows = new Map<string, Post>();
  // Per-region tail hash for chaining. Key = `${tenantId}::${regionId}`.
  const tails = new Map<string, string>();

  function tailKey(tenantId: string, regionId: string): string {
    return `${tenantId}::${regionId}`;
  }

  return {
    async append(input: AppendPostInput): Promise<Post> {
      const t = now();
      const id = randomUUID();
      const tk = tailKey(input.tenantId, input.regionId);
      const prevHash = tails.get(tk) ?? GENESIS_HASH;
      const auditHash = computeBlackboardHash(
        {
          op: 'post',
          tenantId: input.tenantId,
          regionId: input.regionId,
          ksId: input.ksId,
          parentPostId: input.parentPostId ?? null,
          content: input.content,
          structured: input.structured ?? {},
          postedAtIso: t.toISOString(),
        },
        prevHash,
      );
      const row: Post = Object.freeze({
        id,
        tenantId: input.tenantId,
        regionId: input.regionId,
        ksId: input.ksId,
        parentPostId: input.parentPostId ?? null,
        content: input.content,
        contentEmbedding:
          input.contentEmbedding !== undefined
            ? Object.freeze(input.contentEmbedding.slice())
            : null,
        structured: Object.freeze({ ...(input.structured ?? {}) }),
        postedAt: t,
        editCount: 0,
        prevHash,
        auditHash,
      });
      rows.set(id, row);
      tails.set(tk, auditHash);
      return row;
    },

    async listByRegion(tenantId, regionId, options) {
      const matches: Post[] = [];
      for (const row of rows.values()) {
        if (row.tenantId !== tenantId) continue;
        if (row.regionId !== regionId) continue;
        matches.push(row);
      }
      const ascending = options?.ascending ?? false;
      const sorted = matches
        .slice()
        .sort((a, b) =>
          ascending
            ? a.postedAt.getTime() - b.postedAt.getTime()
            : b.postedAt.getTime() - a.postedAt.getTime(),
        );
      if (options?.limit !== undefined) {
        return sorted.slice(0, options.limit);
      }
      return sorted;
    },

    async getById(tenantId, id) {
      const row = rows.get(id);
      if (row === undefined) return null;
      if (row.tenantId !== tenantId) return null;
      return row;
    },
  };
}
