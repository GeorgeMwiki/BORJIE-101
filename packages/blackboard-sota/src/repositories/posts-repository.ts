/**
 * Posts repository — in-memory + SQL adapters.
 *
 * Wave BLACKBOARD-CORE. Both adapters implement `PostsRepository`.
 * Each post chains into the region's per-region audit chain — the
 * first post uses GENESIS_HASH; subsequent posts use the previous
 * post's `audit_hash` as `prev_hash`.
 *
 * @module @borjie/blackboard-sota/repositories/posts-repository
 */

import { GENESIS_HASH } from '@borjie/audit-hash-chain';
import { computeBlackboardHash } from '../audit/hash-chain.js';
import {
  type AppendPostInput,
  type Post,
  type PostsRepository,
} from '../types.js';

let counter = 0;
function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// ---------------------------------------------------------------------------
// In-memory adapter
// ---------------------------------------------------------------------------

export interface InMemoryPostsRepositoryDeps {
  readonly now?: () => Date;
  readonly idFactory?: () => string;
}

export function createInMemoryPostsRepository(
  deps: InMemoryPostsRepositoryDeps = {},
): PostsRepository {
  const now = deps.now ?? (() => new Date());
  const idFactory = deps.idFactory ?? (() => nextId('post'));
  const byId = new Map<string, Post>();
  // Per-region (tenant::region) chain head.
  const lastHashByRegion = new Map<string, string>();

  function regionKey(tenantId: string, regionId: string): string {
    return `${tenantId}::${regionId}`;
  }

  return {
    async append(input: AppendPostInput) {
      const id = idFactory();
      const postedAt = now();
      const k = regionKey(input.tenantId, input.regionId);
      const prev = lastHashByRegion.get(k) ?? GENESIS_HASH;
      const structured = input.structured ?? {};
      const auditHash = computeBlackboardHash(
        {
          kind: 'post:append',
          id,
          tenantId: input.tenantId,
          regionId: input.regionId,
          ksId: input.ksId,
          parentPostId: input.parentPostId ?? null,
          content: input.content,
          structured,
          postedAt: postedAt.toISOString(),
        },
        prev,
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
            ? Object.freeze([...input.contentEmbedding])
            : null,
        structured: Object.freeze({ ...structured }),
        postedAt,
        editCount: 0,
        prevHash: prev,
        auditHash,
      });
      byId.set(id, row);
      lastHashByRegion.set(k, auditHash);
      return row;
    },

    async listByRegion(tenantId, regionId, options) {
      const ascending = options?.ascending ?? false;
      const limit = options?.limit ?? Number.POSITIVE_INFINITY;
      const out: Post[] = [];
      for (const p of byId.values()) {
        if (p.tenantId !== tenantId || p.regionId !== regionId) continue;
        out.push(p);
      }
      out.sort((a, b) =>
        ascending
          ? a.postedAt.getTime() - b.postedAt.getTime()
          : b.postedAt.getTime() - a.postedAt.getTime(),
      );
      const sliced = out.slice(0, limit);
      return Object.freeze([...sliced]);
    },

    async getById(tenantId, id) {
      const p = byId.get(id);
      if (p === undefined || p.tenantId !== tenantId) return null;
      return p;
    },
  };
}

// ---------------------------------------------------------------------------
// SQL adapter
// ---------------------------------------------------------------------------

export interface PostsSqlDriver {
  insertRow(row: Post): Promise<void>;
  selectById(tenantId: string, id: string): Promise<Post | null>;
  selectByRegion(
    tenantId: string,
    regionId: string,
    options?: { readonly limit?: number; readonly ascending?: boolean },
  ): Promise<ReadonlyArray<Post>>;
  selectLastAuditHashForRegion(
    tenantId: string,
    regionId: string,
  ): Promise<string | null>;
}

export function createSqlPostsRepository(
  driver: PostsSqlDriver,
  deps: { readonly now?: () => Date; readonly idFactory?: () => string } = {},
): PostsRepository {
  const now = deps.now ?? (() => new Date());
  const idFactory = deps.idFactory ?? (() => nextId('post'));
  return {
    async append(input) {
      const id = idFactory();
      const postedAt = now();
      const prev =
        (await driver.selectLastAuditHashForRegion(input.tenantId, input.regionId)) ??
        GENESIS_HASH;
      const structured = input.structured ?? {};
      const auditHash = computeBlackboardHash(
        {
          kind: 'post:append',
          id,
          tenantId: input.tenantId,
          regionId: input.regionId,
          ksId: input.ksId,
          parentPostId: input.parentPostId ?? null,
          content: input.content,
          structured,
          postedAt: postedAt.toISOString(),
        },
        prev,
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
            ? Object.freeze([...input.contentEmbedding])
            : null,
        structured: Object.freeze({ ...structured }),
        postedAt,
        editCount: 0,
        prevHash: prev,
        auditHash,
      });
      await driver.insertRow(row);
      return row;
    },
    async listByRegion(tenantId, regionId, options) {
      return driver.selectByRegion(tenantId, regionId, options);
    },
    async getById(tenantId, id) {
      return driver.selectById(tenantId, id);
    },
  };
}
