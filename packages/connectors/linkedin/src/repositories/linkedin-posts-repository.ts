/**
 * LinkedIn posts repository — in-memory port.
 *
 * Idempotent on (tenant_id, account, post_id). Mirrors migration 0047
 * UNIQUE constraint on `linkedin_posts`.
 */

import type { LinkedInPost } from '../types.js';

export interface LinkedInPostsRepository {
  readonly upsert: (post: LinkedInPost) => Promise<{
    readonly inserted: boolean;
  }>;
  readonly listByAccount: (
    tenantId: string,
    account: string,
  ) => Promise<ReadonlyArray<LinkedInPost>>;
}

export function createInMemoryLinkedInPostsRepository(): LinkedInPostsRepository {
  const rows = new Map<string, LinkedInPost>();
  const key = (p: { tenantId: string; account: string; postId: string }): string =>
    `${p.tenantId}::${p.account}::${p.postId}`;

  return Object.freeze({
    async upsert(post: LinkedInPost): Promise<{ inserted: boolean }> {
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
    ): Promise<ReadonlyArray<LinkedInPost>> {
      const out: LinkedInPost[] = [];
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
