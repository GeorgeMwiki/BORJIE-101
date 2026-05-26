/**
 * In-memory reference implementation of `SessionMemoryRepository`
 * (Wave 18GG). Production wires a Postgres-backed adapter; this
 * module exists for tests and ephemeral worker contexts.
 */

import type { SessionMemory, SessionMemoryRepository } from '../types.js';

export function createInMemorySessionMemoryRepository(): SessionMemoryRepository {
  const byThread = new Map<string, SessionMemory>();

  const key = (tenant_id: string, thread_id: string): string =>
    `${tenant_id}::${thread_id}`;

  return {
    async upsert(m) {
      byThread.set(key(m.tenant_id, m.thread_id), m);
    },
    async findByThread(tenant_id, thread_id) {
      return byThread.get(key(tenant_id, thread_id)) ?? null;
    },
    async purgeExpired(now) {
      let removed = 0;
      for (const [k, m] of byThread) {
        if (new Date(m.expires_at).getTime() < now.getTime()) {
          byThread.delete(k);
          removed += 1;
        }
      }
      return removed;
    },
  };
}
