/**
 * In-memory reference implementation of `PendingThreadRepository`
 * (Wave 18GG). Production wires a Postgres-backed adapter; this
 * module exists for tests and ephemeral worker contexts.
 */

import type { PendingThread, PendingThreadRepository } from '../types.js';

export function createInMemoryPendingThreadRepository(): PendingThreadRepository {
  const rows = new Map<string, PendingThread>();

  return {
    async insert(p) {
      rows.set(p.id, p);
    },
    async resolve(id, resolved_at) {
      const existing = rows.get(id);
      if (!existing) return;
      rows.set(id, { ...existing, resolved_at: resolved_at.toISOString() });
    },
    async listUnresolved(tenant_id, user_id) {
      const matches: PendingThread[] = [];
      for (const p of rows.values()) {
        if (p.tenant_id !== tenant_id) continue;
        if (p.user_id !== user_id) continue;
        if (p.resolved_at !== null) continue;
        matches.push(p);
      }
      return matches.sort((a, b) =>
        a.created_at.localeCompare(b.created_at),
      );
    },
  };
}
