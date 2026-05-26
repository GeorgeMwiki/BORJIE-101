/**
 * In-memory repositories for Notion pages + blocks. Idempotent on
 * the UNIQUE keys in migration 0043.
 */

import type { NotionPage, NotionBlock } from '../types.js';

export interface NotionPageRepository {
  readonly insert: (
    row: NotionPage,
  ) => Promise<{ readonly inserted: boolean }>;
  readonly listByTenant: (
    tenantId: string,
  ) => Promise<ReadonlyArray<NotionPage>>;
}

export interface NotionBlockRepository {
  readonly insert: (
    row: NotionBlock,
  ) => Promise<{ readonly inserted: boolean }>;
  readonly listByTenant: (
    tenantId: string,
  ) => Promise<ReadonlyArray<NotionBlock>>;
}

export function createInMemoryNotionPageRepository(): NotionPageRepository {
  const store = new Map<string, NotionPage>();
  const key = (tenantId: string, workspaceId: string, pageId: string): string =>
    `${tenantId}|${workspaceId}|${pageId}`;
  return {
    async insert(row) {
      const k = key(row.tenantId, row.workspaceId, row.pageId);
      if (store.has(k)) return { inserted: false };
      store.set(k, row);
      return { inserted: true };
    },
    async listByTenant(tenantId) {
      return [...store.values()].filter((r) => r.tenantId === tenantId);
    },
  };
}

export function createInMemoryNotionBlockRepository(): NotionBlockRepository {
  const store = new Map<string, NotionBlock>();
  const key = (tenantId: string, workspaceId: string, blockId: string): string =>
    `${tenantId}|${workspaceId}|${blockId}`;
  return {
    async insert(row) {
      const k = key(row.tenantId, row.workspaceId, row.blockId);
      if (store.has(k)) return { inserted: false };
      store.set(k, row);
      return { inserted: true };
    },
    async listByTenant(tenantId) {
      return [...store.values()].filter((r) => r.tenantId === tenantId);
    },
  };
}
