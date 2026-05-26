/**
 * In-memory GitHub records repository.
 */

import type { GitHubEntityPayload } from '../types.js';

export interface GitHubRecordRow {
  readonly id: string;
  readonly tenantId: string;
  readonly account: string;
  readonly entityKind: string;
  readonly entityId: string;
  readonly fields: GitHubEntityPayload;
  readonly updatedAt: string;
  readonly raw: Readonly<Record<string, unknown>>;
  readonly ingestedAt: string;
  readonly auditHash: string;
}

export interface GitHubRecordRepository {
  readonly upsert: (row: GitHubRecordRow) => Promise<GitHubRecordRow>;
  readonly findByKey: (params: {
    readonly tenantId: string;
    readonly account: string;
    readonly entityKind: string;
    readonly entityId: string;
  }) => Promise<GitHubRecordRow | null>;
  readonly all: () => Promise<ReadonlyArray<GitHubRecordRow>>;
}

export function createInMemoryGitHubRepository(): GitHubRecordRepository {
  const byKey = new Map<string, GitHubRecordRow>();
  const k = (t: string, a: string, ek: string, ei: string) => `${t}|${a}|${ek}|${ei}`;
  return {
    async upsert(row) {
      const existing = byKey.get(k(row.tenantId, row.account, row.entityKind, row.entityId));
      if (existing && existing.updatedAt > row.updatedAt) return existing;
      byKey.set(k(row.tenantId, row.account, row.entityKind, row.entityId), row);
      return row;
    },
    async findByKey(p) {
      return byKey.get(k(p.tenantId, p.account, p.entityKind, p.entityId)) ?? null;
    },
    async all() {
      return Array.from(byKey.values());
    },
  };
}
