/**
 * Instagram posts repository — in-memory + SQL port.
 *
 * Idempotent on (tenant_id, account, post_id).
 */

import type { InstagramPost } from '../types.js';

export interface InstagramPostsRepository {
  readonly upsert: (post: InstagramPost) => Promise<{
    readonly inserted: boolean;
  }>;
  readonly listByAccount: (
    tenantId: string,
    account: string,
  ) => Promise<ReadonlyArray<InstagramPost>>;
}

export function createInMemoryInstagramPostsRepository(): InstagramPostsRepository {
  const rows = new Map<string, InstagramPost>();

  const key = (p: { tenantId: string; account: string; postId: string }): string =>
    `${p.tenantId}::${p.account}::${p.postId}`;

  return Object.freeze({
    async upsert(post: InstagramPost): Promise<{ inserted: boolean }> {
      const k = key(post);
      if (rows.has(k)) {
        return Object.freeze({ inserted: false });
      }
      rows.set(k, post);
      return Object.freeze({ inserted: true });
    },

    async listByAccount(
      tenantId: string,
      account: string,
    ): Promise<ReadonlyArray<InstagramPost>> {
      const out: InstagramPost[] = [];
      for (const row of rows.values()) {
        if (row.tenantId !== tenantId) continue;
        if (row.account !== account) continue;
        out.push(row);
      }
      out.sort((a, b) =>
        (a.postedAt ?? '').localeCompare(b.postedAt ?? ''),
      );
      return Object.freeze(out);
    },
  });
}
