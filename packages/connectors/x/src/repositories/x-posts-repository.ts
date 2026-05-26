/**
 * X posts repository — in-memory port.
 *
 * Idempotent on (tenant_id, account, post_id). Mirrors migration 0047
 * UNIQUE constraint on `x_posts`.
 */

import type { XPost } from '../types.js';

export interface XPostsRepository {
  readonly upsert: (post: XPost) => Promise<{
    readonly inserted: boolean;
  }>;
  readonly listByAccount: (
    tenantId: string,
    account: string,
  ) => Promise<ReadonlyArray<XPost>>;
}

export function createInMemoryXPostsRepository(): XPostsRepository {
  const rows = new Map<string, XPost>();
  const key = (p: { tenantId: string; account: string; postId: string }): string =>
    `${p.tenantId}::${p.account}::${p.postId}`;

  return Object.freeze({
    async upsert(post: XPost): Promise<{ inserted: boolean }> {
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
    ): Promise<ReadonlyArray<XPost>> {
      const out: XPost[] = [];
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
