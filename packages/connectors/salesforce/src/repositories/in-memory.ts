/**
 * In-memory Salesforce records repository.
 *
 * Used by unit tests and by composition roots that need a non-DB
 * stand-in. Mirrors the SQL repository interface; both implement the
 * same `SalesforceRecordRepository` port.
 */

import type { SalesforceSObjectPayload } from '../types.js';

export interface SalesforceRecordRow {
  readonly id: string;
  readonly tenantId: string;
  readonly account: string;
  readonly sobjectType: string;
  readonly sobjectId: string;
  readonly fields: SalesforceSObjectPayload;
  readonly lastModifiedDate: string;
  readonly raw: Readonly<Record<string, unknown>>;
  readonly ingestedAt: string;
  readonly auditHash: string;
}

export interface SalesforceRecordRepository {
  readonly upsert: (row: SalesforceRecordRow) => Promise<SalesforceRecordRow>;
  readonly findByKey: (params: {
    readonly tenantId: string;
    readonly account: string;
    readonly sobjectType: string;
    readonly sobjectId: string;
  }) => Promise<SalesforceRecordRow | null>;
  readonly all: () => Promise<ReadonlyArray<SalesforceRecordRow>>;
}

export function createInMemorySalesforceRepository(): SalesforceRecordRepository {
  // Mutable internally; never leaks to callers. Reads return frozen copies.
  const byKey = new Map<string, SalesforceRecordRow>();

  function keyOf(
    tenantId: string,
    account: string,
    sobjectType: string,
    sobjectId: string,
  ): string {
    return `${tenantId}|${account}|${sobjectType}|${sobjectId}`;
  }

  return {
    async upsert(row) {
      const k = keyOf(row.tenantId, row.account, row.sobjectType, row.sobjectId);
      const existing = byKey.get(k);
      if (existing && existing.lastModifiedDate > row.lastModifiedDate) {
        // Out-of-order update — keep newest.
        return existing;
      }
      byKey.set(k, row);
      return row;
    },
    async findByKey(params) {
      return (
        byKey.get(
          keyOf(
            params.tenantId,
            params.account,
            params.sobjectType,
            params.sobjectId,
          ),
        ) ?? null
      );
    },
    async all() {
      return Array.from(byKey.values());
    },
  };
}
