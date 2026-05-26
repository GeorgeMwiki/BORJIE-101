/**
 * TikTok posts repository — in-memory port.
 *
 * Idempotent on (tenant_id, account, post_id). Mirrors migration 0047
 * UNIQUE constraint on `tiktok_posts`.
 */

import type { TikTokPost } from '../types.js';

export interface TikTokPostsRepository {
  readonly upsert: (post: TikTokPost) => Promise<{
    readonly inserted: boolean;
  }>;
  readonly listByAccount: (
    tenantId: string,
    account: string,
  ) => Promise<ReadonlyArray<TikTokPost>>;
}

export function createInMemoryTikTokPostsRepository(): TikTokPostsRepository {
  const rows = new Map<string, TikTokPost>();

  const key = (p: { tenantId: string; account: string; postId: string }): string =>
    `${p.tenantId}::${p.account}::${p.postId}`;

  return Object.freeze({
    async upsert(post: TikTokPost): Promise<{ inserted: boolean }> {
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
    ): Promise<ReadonlyArray<TikTokPost>> {
      const out: TikTokPost[] = [];
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
