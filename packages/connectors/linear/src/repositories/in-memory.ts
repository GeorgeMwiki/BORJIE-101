/**
 * In-memory Linear records repository.
 */

import type { LinearEntityPayload } from '../types.js';

export interface LinearRecordRow {
  readonly id: string;
  readonly tenantId: string;
  readonly account: string;
  readonly entityKind: string;
  readonly entityId: string;
  readonly fields: LinearEntityPayload;
  readonly updatedAt: string;
  readonly raw: Readonly<Record<string, unknown>>;
  readonly ingestedAt: string;
  readonly auditHash: string;
}

export interface LinearRecordRepository {
  readonly upsert: (row: LinearRecordRow) => Promise<LinearRecordRow>;
  readonly findByKey: (params: {
    readonly tenantId: string;
    readonly account: string;
    readonly entityKind: string;
    readonly entityId: string;
  }) => Promise<LinearRecordRow | null>;
  readonly all: () => Promise<ReadonlyArray<LinearRecordRow>>;
}

export function createInMemoryLinearRepository(): LinearRecordRepository {
  const byKey = new Map<string, LinearRecordRow>();
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
