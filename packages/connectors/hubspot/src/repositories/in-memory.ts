/**
 * In-memory HubSpot records repository.
 */

import type { HubSpotObjectPayload } from '../types.js';

export interface HubSpotRecordRow {
  readonly id: string;
  readonly tenantId: string;
  readonly account: string;
  readonly objectType: string;
  readonly objectId: string;
  readonly properties: HubSpotObjectPayload;
  readonly updatedAt: string;
  readonly raw: Readonly<Record<string, unknown>>;
  readonly ingestedAt: string;
  readonly auditHash: string;
}

export interface HubSpotRecordRepository {
  readonly upsert: (row: HubSpotRecordRow) => Promise<HubSpotRecordRow>;
  readonly findByKey: (params: {
    readonly tenantId: string;
    readonly account: string;
    readonly objectType: string;
    readonly objectId: string;
  }) => Promise<HubSpotRecordRow | null>;
  readonly all: () => Promise<ReadonlyArray<HubSpotRecordRow>>;
}

export function createInMemoryHubSpotRepository(): HubSpotRecordRepository {
  const byKey = new Map<string, HubSpotRecordRow>();
  const keyOf = (t: string, a: string, ot: string, oid: string) => `${t}|${a}|${ot}|${oid}`;
  return {
    async upsert(row) {
      const k = keyOf(row.tenantId, row.account, row.objectType, row.objectId);
      const existing = byKey.get(k);
      if (existing && existing.updatedAt > row.updatedAt) return existing;
      byKey.set(k, row);
      return row;
    },
    async findByKey(p) {
      return byKey.get(keyOf(p.tenantId, p.account, p.objectType, p.objectId)) ?? null;
    },
    async all() {
      return Array.from(byKey.values());
    },
  };
}
