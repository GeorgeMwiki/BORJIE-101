/**
 * In-memory Jira records repository.
 */

import type { JiraEntityPayload } from '../types.js';

export interface JiraRecordRow {
  readonly id: string;
  readonly tenantId: string;
  readonly account: string;
  readonly entityKind: string;
  readonly entityId: string;
  readonly fields: JiraEntityPayload;
  readonly updatedAt: string;
  readonly raw: Readonly<Record<string, unknown>>;
  readonly ingestedAt: string;
  readonly auditHash: string;
}

export interface JiraRecordRepository {
  readonly upsert: (row: JiraRecordRow) => Promise<JiraRecordRow>;
  readonly findByKey: (params: {
    readonly tenantId: string;
    readonly account: string;
    readonly entityKind: string;
    readonly entityId: string;
  }) => Promise<JiraRecordRow | null>;
  readonly all: () => Promise<ReadonlyArray<JiraRecordRow>>;
}

export function createInMemoryJiraRepository(): JiraRecordRepository {
  const byKey = new Map<string, JiraRecordRow>();
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
