/**
 * In-memory repository for the Drive connector. Idempotent on
 * (tenantId, account, fileId) — matches the UNIQUE constraint in
 * migration 0043.
 */

import type { DriveFile } from '../types.js';

export interface DriveRepository {
  readonly insert: (
    row: DriveFile,
  ) => Promise<{ readonly inserted: boolean }>;
  readonly upsert: (
    row: DriveFile,
  ) => Promise<{ readonly inserted: boolean; readonly updated: boolean }>;
  readonly listByTenant: (
    tenantId: string,
  ) => Promise<ReadonlyArray<DriveFile>>;
  readonly find: (
    tenantId: string,
    account: string,
    fileId: string,
  ) => Promise<DriveFile | null>;
}

export function createInMemoryDriveRepository(): DriveRepository {
  const store = new Map<string, DriveFile>();
  const key = (tenantId: string, account: string, fileId: string): string =>
    `${tenantId}|${account}|${fileId}`;
  return {
    async insert(row) {
      const k = key(row.tenantId, row.account, row.fileId);
      if (store.has(k)) return { inserted: false };
      store.set(k, row);
      return { inserted: true };
    },
    async upsert(row) {
      const k = key(row.tenantId, row.account, row.fileId);
      const existed = store.has(k);
      store.set(k, row);
      return { inserted: !existed, updated: existed };
    },
    async listByTenant(tenantId) {
      return [...store.values()].filter((r) => r.tenantId === tenantId);
    },
    async find(tenantId, account, fileId) {
      return store.get(key(tenantId, account, fileId)) ?? null;
    },
  };
}
