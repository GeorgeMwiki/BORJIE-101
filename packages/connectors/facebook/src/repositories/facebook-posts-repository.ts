/**
 * Facebook posts repository — in-memory. Idempotent on
 * (tenant_id, account, post_id).
 */

import type { FacebookPost } from '../types.js';

export interface FacebookPostsRepository {
  readonly upsert: (post: FacebookPost) => Promise<{ inserted: boolean }>;
  readonly listByAccount: (
    tenantId: string,
    account: string,
  ) => Promise<ReadonlyArray<FacebookPost>>;
}

export function createInMemoryFacebookPostsRepository(): FacebookPostsRepository {
  const rows = new Map<string, FacebookPost>();
  const key = (p: { tenantId: string; account: string; postId: string }): string =>
    `${p.tenantId}::${p.account}::${p.postId}`;

  return Object.freeze({
    async upsert(post: FacebookPost): Promise<{ inserted: boolean }> {
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
    ): Promise<ReadonlyArray<FacebookPost>> {
      const out: FacebookPost[] = [];
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
