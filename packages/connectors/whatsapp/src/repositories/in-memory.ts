/**
 * In-memory repository for the WhatsApp connector — used in tests and
 * during local development. Mirrors the SQL repository's surface so
 * production code can swap one for the other without changes.
 *
 * Idempotency: insert is a no-op when (tenantId, wabaId, waMessageId)
 * collides, matching the UNIQUE index in migration 0043.
 */

import type { WhatsappMessage } from '../types.js';

export interface WhatsappRepository {
  readonly insert: (
    row: WhatsappMessage,
  ) => Promise<{ readonly inserted: boolean }>;
  readonly listByTenant: (
    tenantId: string,
  ) => Promise<ReadonlyArray<WhatsappMessage>>;
  readonly find: (
    tenantId: string,
    wabaId: string,
    waMessageId: string,
  ) => Promise<WhatsappMessage | null>;
}

export function createInMemoryWhatsappRepository(): WhatsappRepository {
  const store = new Map<string, WhatsappMessage>();
  const key = (tenantId: string, wabaId: string, waMessageId: string): string =>
    `${tenantId}|${wabaId}|${waMessageId}`;
  return {
    async insert(row) {
      const k = key(row.tenantId, row.wabaId, row.waMessageId);
      if (store.has(k)) return { inserted: false };
      store.set(k, row);
      return { inserted: true };
    },
    async listByTenant(tenantId) {
      return [...store.values()]
        .filter((r) => r.tenantId === tenantId)
        .sort((a, b) => (a.ingestedAt < b.ingestedAt ? 1 : -1));
    },
    async find(tenantId, wabaId, waMessageId) {
      return store.get(key(tenantId, wabaId, waMessageId)) ?? null;
    },
  };
}
